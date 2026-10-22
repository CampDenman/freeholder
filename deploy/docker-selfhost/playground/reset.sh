#!/bin/sh
# Copyright (C) 2026 Tony Aly
# SPDX-License-Identifier: Apache-2.0
# C1.38: fixed projects and path prevent resets reaching a client installation.
#
# Two fixed Compose projects take turns. The fresh playground boots on its own
# private network while the current one keeps serving; only once it is ready
# is it given the proxy alias, and then the old one is stopped and removed.
# Caddy retries a failed connection for a while (lb_try_duration), so a reset
# is a brief hand-over rather than a minute of errors.
#
# Overlap needs room for a second app and database. When the host has less
# than PLAYGROUND_OVERLAP_MIN_MB available, the old playground stops first, as
# it always used to: a slower reset, never production's memory.
set -eu
exec 9>/run/lock/freeholder-playground.lock
flock -n 9 || exit 0
cd /opt/freeholder-playground
PROXY_NETWORK=freeholder-playground-proxy
ALIAS=playground-app

compose() {
  project=$1
  shift
  docker compose --project-name "$project" --file compose.yml "$@"
}
app_of() { compose "$1" ps -q app 2>/dev/null || true; }

if [ -n "$(app_of freeholder-playground)" ]; then
  old=freeholder-playground new=freeholder-playground-b
else
  old=freeholder-playground-b new=freeholder-playground
fi

available_mb=$(awk '/^MemAvailable:/ { print int($2 / 1024) }' /proc/meminfo)
if [ "$available_mb" -lt "${PLAYGROUND_OVERLAP_MIN_MB:-1400}" ]; then
  compose "$old" down --timeout 5
fi
# A previous failed reset may have left the standby half-started.
compose "$new" down --timeout 5
compose "$new" up -d
app=$(app_of "$new")
attempt=0
# Ready means migrated, seeded, jobs running and the entry page rendering; the
# home page is fetched too so the first visitor does not pay for a cold render.
until docker exec "$app" node -e 'Promise.all([fetch("http://localhost:3000/api/health"),fetch("http://localhost:3000/playground"),fetch("http://localhost:3000/")]).then(async ([health,entry,home])=>{const b=await health.json();if(!health.ok||!b.ok||!b.jobs?.ready||!entry.ok||!home.ok)process.exit(1)}).catch(()=>process.exit(1))'; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 60 ]; then
    echo 'Playground reset failed readiness; the previous playground, if any, keeps serving.' >&2
    compose "$new" down --timeout 5
    exit 1
  fi
  sleep 3
done

docker network connect --alias "$ALIAS" "$PROXY_NETWORK" "$app"
# Stopping (rather than first disconnecting) the old app lets its process close
# Caddy's keep-alive connections cleanly; Docker drops its alias as it stops.
if [ -n "$(app_of "$old")" ]; then
  compose "$old" down --timeout 5
fi
