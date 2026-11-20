#!/bin/sh
# Copyright (C) 2026 Tony Aly
# SPDX-License-Identifier: Apache-2.0
# C1.38: fixed projects and path prevent resets reaching a client installation.
#
# Two fixed Compose projects take turns. The serving one is the running app with
# the `playground-app` alias on the proxy network. The fresh one boots on
# its own private network while the serving one keeps answering; only once it
# is ready is it given the alias, and then the old one is stopped and removed.
# Caddy retries a failed connection for a while (lb_try_duration), so a reset
# is a brief hand-over rather than a minute of errors. Until that hand-over
# commits, any failure tears the fresh stack down and leaves the serving one
# alone.
#
# Overlap needs room for a second app and database (their caps total 1,408 MB)
# plus a reserve for production. When the host has less than
# PLAYGROUND_OVERLAP_MIN_MB available (default 2200: those caps and ~800 MB
# for production's own growth and page cache), the old playground stops
# first, as it always used to: a slower reset, never production's memory.
#
# `reset.sh --heal` (freeholder-playground-heal.timer, every two minutes)
# asks the serving app's schema probe (/api/health/db), not readiness, which
# also fails while a busy demo's job heartbeats run late. It rebuilds only
# after two consecutive failed checks. When the host lacks room to overlap, it
# never stops a playground that still answers HTTP unless its database has
# lost its schema (a killed tmpfs database comes back empty); it logs and
# waits instead. With nothing serving at all it rebuilds at once.
set -eu
mode=${1:-}
case "$#:$mode" in
  0:|1:--heal|1:--update-image) ;;
  *) echo 'Usage: reset.sh [--heal|--update-image]' >&2; exit 2 ;;
esac
exec 9>/run/lock/freeholder-playground.lock
if ! flock -n 9; then
  [ "$mode" = --update-image ] || exit 0
  echo 'Playground reset or update already holds the lock.' >&2
  exit 1
fi
PLAYGROUND_PATH=/opt/freeholder-playground
cd -P "$PLAYGROUND_PATH"
[ "$PWD" = "$PLAYGROUND_PATH" ] || { echo 'Refusing a redirected playground directory.' >&2; exit 2; }
PROXY_NETWORK=freeholder-playground-proxy
ALIAS=playground-app
A=freeholder-playground
B=freeholder-playground-b

compose() {
  project=$1
  shift
  docker compose --project-name "$project" --file compose.yml "$@"
}
app_of() { compose "$1" ps -q app 2>/dev/null || true; }
proxy_aliases() {
  docker inspect --format "{{if .State.Running}}{{with index .NetworkSettings.Networks \"$PROXY_NETWORK\"}}{{range .Aliases}}{{println .}}{{end}}{{end}}{{end}}" "$1"
}
select_projects() {
  holders=$(proxy_holders) || return 1
  case "$holders" in
    *'
'*) current_app=$(reconcile_interrupted_handover "$holders") || return 1 ;;
    *) current_app=$holders ;;
  esac
  if [ -z "$current_app" ] || [ "$current_app" = "$(app_of "$B")" ]; then
    old=$B new=$A
  elif [ "$current_app" = "$(app_of "$A")" ]; then
    old=$A new=$B
  else
    echo 'The playground proxy alias belongs to an unexpected container.' >&2
    return 1
  fi
}

FAILURES=/run/lock/freeholder-playground.heal-failures
available_mb=$(awk '/^MemAvailable:/ { print int($2 / 1024) }' /proc/meminfo)
room=0
[ "$available_mb" -ge "${PLAYGROUND_OVERLAP_MIN_MB:-2200}" ] && room=1

app_ready() {
  timeout 15 docker exec "$1" node -e 'Promise.all([fetch("http://localhost:3000/api/health"),fetch("http://localhost:3000/playground"),fetch("http://localhost:3000/")]).then(async ([health,entry,home])=>{const b=await health.json();if(!health.ok||!b.ok||!b.jobs?.ready||!entry.ok||!home.ok)process.exit(1)}).catch(()=>process.exit(1))'
}

# Run in a subshell so explicitly selecting an image for this boot does not
# change the on-disk pin or the environment of a subsequent rollback.
handover() (
  if [ -n "${1:-}" ]; then export FREEHOLDER_IMAGE="$1"; fi
  if [ "$room" = 0 ]; then
    compose "$old" down --timeout 5 || exit 1
  fi
  # A previous failed reset may have left the standby half-started.
  compose "$new" down --timeout 5 || exit 1
  trap 'compose "$new" down --timeout 5 >/dev/null 2>&1 || true' EXIT
  compose "$new" up -d || exit 1
  app=$(app_of "$new")
  attempt=0
  # Ready means migrated, seeded, jobs running and the entry page rendering.
  # Warm the home page too before introducing the new proxy endpoint.
  until app_ready "$app"; do
    attempt=$((attempt + 1))
    if [ "$attempt" -ge 60 ]; then
      echo 'Playground reset failed readiness.' >&2
      exit 1
    fi
    sleep 3
  done
  if [ -n "${2:-}" ] && [ "$(container_image "$app")" != "$1 $2" ]; then
    echo 'Standby playground is running a different image.' >&2
    exit 1
  fi

  docker network connect --alias "$ALIAS" "$PROXY_NETWORK" "$app" || exit 1
  # Both apps may answer while the old app shuts down. From this point,
  # remove an alias only after inspecting the real holders.
  trap - EXIT
  # Stopping lets the old app close Caddy's keep-alive connections cleanly.
  retired=1
  if [ -n "$(app_of "$old")" ] && ! compose "$old" down --timeout 5; then
    echo 'Could not finish retiring the previous playground.' >&2
    retired=0
  fi
  holders=$(proxy_holders) || exit 1
  if [ "$holders" = "$app" ]; then
    [ "$retired" = 1 ] || exit 1
    rm -f "$FAILURES" || exit 1
    exit 0
  fi

  echo 'Playground handover did not establish the standby as the sole proxy alias holder.' >&2
  if is_alias_pair "$holders" "$current_app" "$app"; then
    if app_ready "$current_app"; then
      if disconnect_managed_alias "$current_app" "$app"; then
        compose "$new" down --timeout 5 || echo 'Standby cleanup remains pending.' >&2
      fi
    else
      disconnect_managed_alias "$app" "$current_app" || exit 1
    fi
  fi
  exit 1
)

# Enumerate the actual proxy network, including unexpected members.
proxy_holders() {
  members=$(docker network inspect --format '{{range $id, $_ := .Containers}}{{println $id}}{{end}}' "$PROXY_NETWORK") || return 1
  for member in $members; do
    aliases=$(proxy_aliases "$member") || return 1
    if printf '%s\n' "$aliases" | grep -Fxq "$ALIAS"; then
      printf '%s\n' "$member"
    fi
  done
}

# The freshness check always requires one holder. It cannot repair ambiguity
# and also use the same observation as proof of a successful deployment.
proxy_app() {
  holders=$(proxy_holders) || return 1
  case "$holders" in
    *'
'*) echo 'Multiple running containers hold the playground proxy alias.' >&2; return 1 ;;
    *) printf '%s' "$holders" ;;
  esac
}

is_alias_pair() {
  [ -n "$2" ] && [ -n "$3" ] && [ "$2" != "$3" ] &&
    { [ "$1" = "$(printf '%s\n%s' "$2" "$3")" ] || [ "$1" = "$(printf '%s\n%s' "$3" "$2")" ]; }
}

disconnect_managed_alias() {
  keeper=$1 discard=$2
  attached=$(proxy_holders) || return 1
  if ! is_alias_pair "$attached" "$keeper" "$discard" ||
     ! is_alias_pair "$attached" "$(app_of "$A")" "$(app_of "$B")"; then
    echo 'The managed alias pair changed. Refusing to disconnect either app.' >&2
    return 1
  fi
  timeout 15 docker network disconnect "$PROXY_NETWORK" "$discard" >/dev/null ||
    echo 'Could not confirm the alias disconnect from Docker.' >&2
  if [ "$(proxy_app)" != "$keeper" ]; then
    echo 'Could not verify a sole managed proxy holder after disconnect.' >&2
    return 1
  fi
}

reconcile_interrupted_handover() {
  a_app=$(app_of "$A") b_app=$(app_of "$B")
  if ! is_alias_pair "$1" "$a_app" "$b_app"; then
    echo 'Multiple running containers hold the playground proxy alias outside the managed pair.' >&2
    return 1
  fi

  saved_pin=$(sed -n 's/^FREEHOLDER_IMAGE=//p' .env) || return 1
  if ! printf '%s\n' "$saved_pin" | grep -Exq '[a-zA-Z0-9./:_-]+@sha256:[a-f0-9]{64}'; then
    echo 'Interrupted handover recovery requires a saved immutable image pin.' >&2
    return 1
  fi
  a_image=$(container_image "$a_app") || return 1
  b_image=$(container_image "$b_app") || return 1
  if [ "${a_image%% *}" = "$saved_pin" ] && app_ready "$a_app" >/dev/null; then
    keep_app=$a_app discard_app=$b_app discard_project=$B
  elif [ "${b_image%% *}" = "$saved_pin" ] && app_ready "$b_app" >/dev/null; then
    keep_app=$b_app discard_app=$a_app discard_project=$A
  else
    echo 'Neither managed proxy holder is ready on the saved image pin.' >&2
    return 1
  fi

  disconnect_managed_alias "$keep_app" "$discard_app" || return 1
  compose "$discard_project" down --timeout 5 >&2 || echo 'Standby cleanup remains pending.' >&2
  echo 'Reconciled an interrupted playground handover to the saved image.' >&2
  printf '%s' "$keep_app"
}

container_image() { docker inspect --format '{{.Config.Image}} {{.Image}}' "$1"; }
is_target_serving() {
  serving_app=$(proxy_app) && [ -n "$serving_app" ] &&
    [ "$(container_image "$serving_app")" = "$target $target_id" ]
}
verify_public() {
  is_target_serving || { echo 'The proxy alias does not serve the promoted digest.' >&2; return 1; }
  attempt=1
  home_code=not-checked
  while [ "$attempt" -le 18 ]; do
    code=$(curl -sS --max-time 15 -o /dev/null -w '%{http_code}' https://demo.freeholder.ai/api/health) || code=000
    if [ "$code" = 200 ]; then
      is_target_serving || { echo 'The proxy alias changed during the public readiness check.' >&2; return 1; }
      home_code=$(curl -sS --max-time 8 -o /dev/null -w '%{http_code}' https://demo.freeholder.ai/) || home_code=000
      is_target_serving || { echo 'The proxy alias changed during the public homepage check.' >&2; return 1; }
      [ "$home_code" != 200 ] || return 0
    fi
    attempt=$((attempt + 1))
    if [ "$attempt" -le 18 ]; then sleep 10; fi
  done
  echo "Public playground health returned HTTP $code. Homepage probe: $home_code." >&2
  return 1
}

persist_pin() {
  next_env=$(mktemp .env.next.XXXXXXXX) || return 1
  if cp -p .env "$next_env" && sed "s|^FREEHOLDER_IMAGE=.*|FREEHOLDER_IMAGE=$target|" .env > "$next_env" &&
     mv -f "$next_env" .env; then
    return 0
  fi
  rm -f "$next_env"
  return 1
}

update_image() {
  if [ ! -f .env ] || [ -L .env ]; then
    echo 'The playground needs a regular .env file for atomic repinning.' >&2
    return 1
  fi
  prior_pin=$(sed -n 's/^FREEHOLDER_IMAGE=//p' .env)
  if ! printf '%s' "$prior_pin" | grep -Exq '[a-zA-Z0-9./:_-]+@sha256:[a-f0-9]{64}' ||
     [ "$(grep -Ec '^[[:blank:]]*(export[[:blank:]]+)?FREEHOLDER_IMAGE[[:blank:]]*([=:]|$)' .env)" -ne 1 ]; then
    echo 'A single immutable FREEHOLDER_IMAGE pin is required.' >&2
    return 1
  fi
  select_projects || return 1
  previous_app=$current_app
  previous_image=$prior_pin
  previous_id=
  if [ -n "$previous_app" ]; then
    previous_metadata=$(container_image "$previous_app") || return 1
    previous_image=${previous_metadata%% *}
    previous_id=${previous_metadata#* }
    if ! printf '%s\n' "$previous_image" | grep -Exq '[a-zA-Z0-9./:_-]+@sha256:[a-f0-9]{64}' ||
       ! printf '%s\n' "$previous_id" | grep -Exq 'sha256:[a-f0-9]{64}'; then
      echo 'The serving playground does not have an immutable rollback image.' >&2
      return 1
    fi
  fi

  repo=ghcr.io/campdenman/freeholder
  pull=$(docker pull "$repo:edge") || return 1
  digest=$(printf '%s\n' "$pull" | sed -n 's/^Digest: //p')
  if ! printf '%s' "$digest" | grep -Exq 'sha256:[a-f0-9]{64}' ||
     [ "$(printf '%s\n' "$digest" | wc -l)" -ne 1 ]; then
    echo 'Could not resolve a single promoted image digest.' >&2
    return 1
  fi
  target="$repo@$digest"
  target_id=$(docker image inspect --format '{{.Id}}' "$target") || return 1
  if ! printf '%s\n' "$target_id" | grep -Exq 'sha256:[a-f0-9]{64}'; then
    echo 'Could not resolve the promoted image ID.' >&2
    return 1
  fi

  if is_target_serving; then
    verify_public || return 1
    if [ "$prior_pin" != "$target" ]; then persist_pin || return 1; fi
    printf 'Playground already serves %s.\n' "$target"
    return 0
  fi

  select_projects || return 1
  if [ "$current_app" != "$previous_app" ]; then
    echo 'The playground proxy alias changed while resolving the promoted image.' >&2
    return 1
  fi
  if handover "$target" "$target_id" && verify_public && persist_pin; then
    printf 'Playground now serves %s.\n' "$target"
    return 0
  fi

  echo 'Playground update failed before committing the new pin.' >&2
  failed_app=$(proxy_app) || return 1
  if [ -n "$failed_app" ] && [ "$failed_app" = "$previous_app" ]; then
    echo 'The previous playground is still serving.' >&2
  elif [ "$previous_image" != "$target" ]; then
    if select_projects && handover "$previous_image" "$previous_id" && restored_app=$(proxy_app) &&
       [ -n "$restored_app" ] && restored_metadata=$(container_image "$restored_app") &&
       [ "${restored_metadata%% *}" = "$previous_image" ] &&
       { [ -z "$previous_id" ] || [ "$restored_metadata" = "$previous_image $previous_id" ]; }; then
      echo 'Restored the previous playground image.' >&2
    else
      echo 'Playground rollback could not be verified.' >&2
    fi
  fi
  return 1
}

if [ "$mode" = --update-image ]; then
  update_image
  exit
fi

select_projects
if [ "$mode" = --heal ]; then
  if [ -n "$current_app" ]; then
    # ok | missing (schema gone) | failing (database errors) | slow (probe
    # timed out but the process answers) | down (no HTTP answer at all)
    state=$(timeout 30 docker exec "$current_app" node -e 'const t=(p)=>fetch("http://localhost:3000"+p,{signal:AbortSignal.timeout(10000)});t("/api/health/db").then(async(r)=>{if(r.ok)return "ok";const b=await r.json().catch(()=>({}));return b.reason==="schema_missing"?"missing":"failing"}).catch(()=>t("/api/health/live").then((r)=>r.ok?"slow":"down",()=>"down")).then((s)=>console.log(s))' 2>/dev/null || true)
    [ -n "$state" ] || state=down
    if [ "$state" = ok ]; then
      rm -f "$FAILURES"
      exit 0
    fi
    count=$(($(cat "$FAILURES" 2>/dev/null || echo 0) + 1))
    echo "$count" > "$FAILURES"
    if [ "$count" -lt 2 ]; then
      echo "Playground probe: $state; waiting for a second consecutive failure." >&2
      exit 0
    fi
    if [ "$room" = 0 ] && [ "$state" != missing ] && [ "$state" != down ]; then
      echo "Playground probe: $state, but it still answers and the host lacks room to rebuild beside it; leaving it serving." >&2
      exit 0
    fi
    echo "Playground probe: $state twice; rebuilding." >&2
  else
    echo 'No playground is serving; rebuilding.' >&2
  fi
fi
handover
