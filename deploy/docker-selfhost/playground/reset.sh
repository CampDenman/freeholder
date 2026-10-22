#!/bin/sh
# Copyright (C) 2026 Tony Aly
# SPDX-License-Identifier: Apache-2.0
# C1.38: fixed projects and path prevent resets reaching a client installation.
#
# Two fixed Compose projects take turns. The serving one is whichever app holds
# the proxy network (and so the `playground-app` alias). The fresh one boots on
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
exec 9>/run/lock/freeholder-playground.lock
flock -n 9 || exit 0
cd /opt/freeholder-playground
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
serving() {
  id=$(app_of "$1")
  [ -n "$id" ] && docker inspect --format "{{if index .NetworkSettings.Networks \"$PROXY_NETWORK\"}}yes{{end}}" "$id" 2>/dev/null | grep -q yes
}

if serving "$A"; then
  old=$A new=$B
elif serving "$B"; then
  old=$B new=$A
else
  old=$B new=$A
fi

FAILURES=/run/lock/freeholder-playground.heal-failures
available_mb=$(awk '/^MemAvailable:/ { print int($2 / 1024) }' /proc/meminfo)
room=0
[ "$available_mb" -ge "${PLAYGROUND_OVERLAP_MIN_MB:-2200}" ] && room=1

if [ "${1:-}" = --heal ]; then
  current=$(app_of "$old")
  if [ -n "$current" ] && serving "$old"; then
    # ok | missing (schema gone) | failing (database errors) | slow (probe
    # timed out but the process answers) | down (no HTTP answer at all)
    state=$(timeout 30 docker exec "$current" node -e 'const t=(p)=>fetch("http://localhost:3000"+p,{signal:AbortSignal.timeout(10000)});t("/api/health/db").then(async(r)=>{if(r.ok)return "ok";const b=await r.json().catch(()=>({}));return b.reason==="schema_missing"?"missing":"failing"}).catch(()=>t("/api/health/live").then((r)=>r.ok?"slow":"down",()=>"down")).then((s)=>console.log(s))' 2>/dev/null || true)
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

if [ "$room" = 0 ]; then
  compose "$old" down --timeout 5
fi
# A previous failed reset may have left the standby half-started.
compose "$new" down --timeout 5
trap 'compose "$new" down --timeout 5 >/dev/null 2>&1 || true' EXIT
compose "$new" up -d
app=$(app_of "$new")
attempt=0
# Ready means migrated, seeded, jobs running and the entry page rendering; the
# home page is fetched too so the first visitor does not pay for a cold render.
until docker exec "$app" node -e 'Promise.all([fetch("http://localhost:3000/api/health"),fetch("http://localhost:3000/playground"),fetch("http://localhost:3000/")]).then(async ([health,entry,home])=>{const b=await health.json();if(!health.ok||!b.ok||!b.jobs?.ready||!entry.ok||!home.ok)process.exit(1)}).catch(()=>process.exit(1))'; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 60 ]; then
    echo 'Playground reset failed readiness; the previous playground, if any, keeps serving.' >&2
    exit 1
  fi
  sleep 3
done

docker network connect --alias "$ALIAS" "$PROXY_NETWORK" "$app"
# The fresh playground now serves: from here a failure must not remove it.
trap - EXIT
rm -f "$FAILURES"
# Stopping (rather than first disconnecting) the old app lets its process close
# Caddy's keep-alive connections cleanly; Docker drops its alias as it stops.
if [ -n "$(app_of "$old")" ]; then
  compose "$old" down --timeout 5
fi
