#!/bin/sh
# Copyright (C) 2026 Tony Aly
# SPDX-License-Identifier: Apache-2.0
# C1.38: fixed project and path prevent resets reaching a client installation.
set -eu
exec 9>/run/lock/freeholder-playground.lock
flock -n 9 || exit 0
cd /opt/freeholder-playground
docker compose --project-name freeholder-playground --file compose.yml down --timeout 30
docker compose --project-name freeholder-playground --file compose.yml up -d
app=$(docker compose --project-name freeholder-playground --file compose.yml ps -q app)
attempt=0
until docker exec "$app" node -e 'fetch("http://localhost:3000/api/health").then(async r=>{const b=await r.json();if(!r.ok||!b.ok||!b.jobs?.ready)process.exit(1)}).catch(()=>process.exit(1))'; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 60 ]; then echo 'Playground reset failed readiness.' >&2; exit 1; fi
  sleep 3
done
