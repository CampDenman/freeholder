#!/usr/bin/env bash
# Copyright (C) 2026 Tony Aly
# SPDX-License-Identifier: Apache-2.0
#
# Move the public playground (demo.freeholder.ai) onto the currently promoted
# image, and put it back if that image does not serve.
#
# Tony's standing rule: the demo must always carry the latest code. This is the
# host side of enforcing it; .forgejo/workflows/deploy-demo.yml is the trigger.
#
# It repins FREEHOLDER_IMAGE in this directory's .env, because that is how the
# playground actually takes an image (compose.yml reads
# `image: ${FREEHOLDER_IMAGE:?Pin a verified image digest}`). It deliberately
# does NOT use scripts/deploy-droplet.mjs: that expects production's layout and
# refuses to swap unless a backup.sh sits beside compose.yml, which the
# playground directory does not have.
#
# `edge` is the tag CI moves onto a build once it is promoted; the
# `candidate-<sha>` tag is the pre-promotion one and is deliberately not used
# here. The digest is resolved on this host rather than through a registry API,
# so no registry token is needed in CI.
set -euo pipefail

DIR="${PLAYGROUND_DIR:-/opt/freeholder-playground}"
REPO="${PLAYGROUND_IMAGE_REPO:-ghcr.io/campdenman/freeholder}"
TAG="${PLAYGROUND_IMAGE_TAG:-edge}"
HEALTH_URL="${PLAYGROUND_HEALTH_URL:-https://demo.freeholder.ai/api/health}"
HEALTH_ATTEMPTS="${PLAYGROUND_HEALTH_ATTEMPTS:-18}"

# Production and the playground share this droplet and differ only by
# directory. Refuse the production one outright: this script runs unattended.
test "$DIR" != "/opt/freeholder" || { echo "refusing: $DIR is production" >&2; exit 2; }
test -f "$DIR/compose.yml" || { echo "refusing: no compose.yml in $DIR" >&2; exit 2; }
test -f "$DIR/.env" || { echo "refusing: no .env in $DIR" >&2; exit 2; }

cd "$DIR"
docker pull --quiet "$REPO:$TAG" >/dev/null
target="$(docker image inspect "$REPO:$TAG" --format '{{index .RepoDigests 0}}')"
case "$target" in *@sha256:*) ;; *) echo "refusing: could not resolve a digest for $REPO:$TAG" >&2; exit 2 ;; esac

current="$(sed -n 's/^FREEHOLDER_IMAGE=//p' .env | head -1)"
if [ "$current" = "$target" ]; then
  echo "already current: ${target#*@}"
  exit 0
fi

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
cp -a .env ".env.pre-$stamp"
echo "backup: .env.pre-$stamp"
echo "repin : ${current#*@} -> ${target#*@}"

restore() {
  echo "restoring previous pin" >&2
  cp -a ".env.pre-$stamp" .env
  docker compose up -d >/dev/null 2>&1 || true
}

sed -i "s|^FREEHOLDER_IMAGE=.*|FREEHOLDER_IMAGE=$target|" .env
grep -qx "FREEHOLDER_IMAGE=$target" .env || { restore; echo "refusing: .env did not take the new pin" >&2; exit 1; }

if ! docker compose up -d; then
  restore
  echo "compose up failed; previous pin restored" >&2
  exit 1
fi

# The playground joins the proxy network only once reset.sh has seen it ready,
# so a 502/503 here is "not yet", not "broken" — keep asking before judging.
for attempt in $(seq 1 "$HEALTH_ATTEMPTS"); do
  code="$(curl -sS --max-time 15 -o /dev/null -w '%{http_code}' "$HEALTH_URL" || true)"
  if [ "$code" = "200" ]; then
    echo "healthy on ${target#*@} after ${attempt} attempt(s)"
    exit 0
  fi
  sleep 10
done

restore
echo "unhealthy after $HEALTH_ATTEMPTS attempts (last status ${code:-none}); previous pin restored" >&2
exit 1
