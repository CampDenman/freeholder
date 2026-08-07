#!/usr/bin/env bash
# Copyright (C) 2026 Tony Aly
# SPDX-License-Identifier: AGPL-3.0-only
#
# The public-surface gates (MASTER.md §15.2, §15.7).
#
# Boots the built image with the demo business installed and points the SEO
# crawler and the accessibility smoke test at it. Both run against a real
# server rendering real pages, because every interesting failure lives in the
# gap between the source and what a browser is actually sent: a canonical built
# from the wrong origin, alt text lost by the block that renders it, a title
# that was unique in the database and duplicated once a template appended the
# site name.
#
# This is also the reason `seed/` exists. Without a demo site there is nothing
# to crawl, and a crawl gate over an empty instance is a green tick that
# checked one page.
set -euo pipefail

IMAGE="${CI_IMAGE:-freeholder:ci}"
DB="${GATE_DB:-freeholder_demo}"
PORT="${GATE_PORT:-3200}"
PGHOST="${PGHOST:-localhost}"
PGUSER="${PGUSER:-postgres}"
export PGPASSWORD="${PGPASSWORD:-postgres}"

BASE="http://localhost:${PORT}"

cleanup() { docker rm -f fh-demo >/dev/null 2>&1 || true; }
trap cleanup EXIT

psql -h "$PGHOST" -U "$PGUSER" -d postgres -c "drop database if exists ${DB}" >/dev/null
psql -h "$PGHOST" -U "$PGUSER" -d postgres -c "create database ${DB}" >/dev/null

# FREEHOLDER_UNSAFE_LOCAL_STORAGE because there is no bucket in CI and the
# container is thrown away thirty seconds later. §18's mandate is about an
# owner's media outliving their server, which is not what this is.
#
# LOCAL_STORAGE_ROOT under /tmp because the image runs as a non-root user and
# cannot create `.data` beside the application. The first CI run of this gate
# failed on exactly that — and failed *loudly*, because the demo-installed
# check below caught an instance with no content instead of crawling it and
# reporting a clean site.
docker run -d --name fh-demo --network host \
  -e SESSION_SECRET=public-gates-secret-that-is-32-chars \
  -e APP_URL="$BASE" \
  -e PORT="$PORT" \
  -e DATABASE_URL="postgres://${PGUSER}:${PGPASSWORD}@${PGHOST}:5432/${DB}" \
  -e FREEHOLDER_SEED_DEMO=1 \
  -e FREEHOLDER_UNSAFE_LOCAL_STORAGE=1 \
  -e LOCAL_STORAGE_ROOT=/tmp/freeholder-media \
  "$IMAGE" >/dev/null

code=""
for _ in $(seq 1 90); do
  code=$(curl -s -o /dev/null -w '%{http_code}' "${BASE}/api/health" || true)
  [ "$code" = "200" ] && break
  sleep 1
done
if [ "$code" != "200" ]; then
  echo "::error title=Public gates::the seeded instance never became healthy (last status ${code})"
  docker logs fh-demo
  exit 1
fi

# The demo has to have actually installed. Without this the gates would run
# against a bare instance and pass by having nothing to look at — the exact
# failure mode a crawl gate is prone to.
#
# Waited for rather than checked once: /api/health answers 200 as soon as the
# server is listening, and the seed is still running behind it. That race was
# always there and was always won by luck — adding a location to the demo made
# the seed slow enough to lose it, and the failure read as "the demo did not
# install" directly above a log line saying it had.
installed=""
for _ in $(seq 1 60); do
  if docker logs fh-demo 2>&1 | grep -q "demo installed"; then
    installed="yes"
    break
  fi
  sleep 1
done
if [ -z "$installed" ]; then
  echo "::error title=Public gates::the demo did not install; there is nothing to crawl"
  docker logs fh-demo
  exit 1
fi
docker logs fh-demo 2>&1 | grep "demo installed"

# §18's recipe validation matrix wants doctor run against a booted image, and
# doctor is owner-only — so CI becomes the owner. `registerOwner` succeeds
# exactly once per instance, and this container is thrown away.
DOCTOR_EMAIL="ci@example.test"
DOCTOR_PASSWORD="a-ci-owner-password-long-enough"
curl -s -o /dev/null -X POST "${BASE}/api/setup/owner"   -H 'content-type: application/json'   -d "{\"email\":\"${DOCTOR_EMAIL}\",\"password\":\"${DOCTOR_PASSWORD}\"}"

# Warnings are expected here — no mail adapter, no real bucket, media on the
# container's own disk — so the gate reasons about *which* checks failed rather
# than whether any did.
#
# `env.appUrl` is the one failure this container earns honestly: it is a
# production build serving on localhost, which is broken for a real deploy and
# correct for a throwaway. Doctor is right to fail it; the exemption belongs
# here, where it is visible, rather than in a check that would then be wrong
# for everybody.
set +e
FREEHOLDER_URL="$BASE" FREEHOLDER_EMAIL="$DOCTOR_EMAIL"   FREEHOLDER_PASSWORD="$DOCTOR_PASSWORD" node scripts/doctor.mjs
FREEHOLDER_URL="$BASE" FREEHOLDER_EMAIL="$DOCTOR_EMAIL"   FREEHOLDER_PASSWORD="$DOCTOR_PASSWORD" node scripts/doctor.mjs --json > /tmp/doctor.json
set -e

node -e '
  const report = JSON.parse(require("fs").readFileSync("/tmp/doctor.json", "utf8"));
  const expected = new Set(["env.appUrl"]);
  const unexpected = report.checks
    .filter((check) => check.verdict === "fail" && !expected.has(check.id))
    .map((check) => `${check.id}: ${check.detail}`);
  if (unexpected.length > 0) {
    console.error("::error title=Doctor::" + unexpected.join(" | "));
    process.exitCode = 1;
  } else {
    console.log("Doctor: no unexpected failures.");
  }
'
echo

node scripts/seo-gate.mjs "$BASE"
echo
# The French home too: a translated page is a different template as far as
# `lang`, direction and the language switcher are concerned.
node scripts/a11y-smoke.mjs "$BASE" / /services /services/weddings /contact /fr-CA
