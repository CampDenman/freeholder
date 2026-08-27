#!/usr/bin/env bash
# Copyright (C) 2026 Tony Aly
# SPDX-License-Identifier: Apache-2.0
# Boot the release image once per Tier-1 recipe against real PostgreSQL and
# S3-compatible storage, claim the seeded instance, and run canonical Doctor.
set -euo pipefail

IMAGE="${CI_IMAGE:-freeholder:ci}"
PORT="${RECIPE_GATE_PORT:-3300}"
BASE="http://127.0.0.1:${PORT}"
PGHOST="${PGHOST:-127.0.0.1}"
PGUSER="${PGUSER:-postgres}"
export PGPASSWORD="${PGPASSWORD:-postgres}"
OWNER_EMAIL="recipe-gate@example.test"
OWNER_PASSWORD="recipe-gate-password-32-characters"
TARGETS=(replit digitalocean-app digitalocean-droplet railway render docker-selfhost)

cleanup() {
  docker rm -f freeholder-recipe-gate >/dev/null 2>&1 || true
}
trap cleanup EXIT

for target in "${TARGETS[@]}"; do
  cleanup
  database="freeholder_recipe_${target//-/_}"
  psql -h "$PGHOST" -U "$PGUSER" -d postgres -c "drop database if exists ${database}" >/dev/null
  psql -h "$PGHOST" -U "$PGUSER" -d postgres -c "create database ${database}" >/dev/null

  docker run -d --name freeholder-recipe-gate --network host \
    -e PORT="$PORT" \
    -e NODE_ENV=production \
    -e APP_URL="$BASE" \
    -e SESSION_SECRET=recipe-gate-session-secret-is-long-enough \
    -e CREDENTIAL_KEY=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA= \
    -e DATABASE_URL="postgres://${PGUSER}:${PGPASSWORD}@${PGHOST}:5432/${database}" \
    -e FREEHOLDER_SEED_DEMO=1 \
    -e FREEHOLDER_STORAGE=s3 \
    -e S3_ENDPOINT=http://127.0.0.1:9000 \
    -e S3_REGION=us-east-1 \
    -e S3_BUCKET=freeholder-recipe-gate \
    -e S3_ACCESS_KEY_ID=freeholder-ci \
    -e S3_SECRET_ACCESS_KEY=freeholder-ci-secret \
    -e S3_ADDRESSING_STYLE=path \
    -e FREEHOLDER_RECIPE_TARGET="$target" \
    "$IMAGE" >/dev/null

  code=""
  for _ in $(seq 1 90); do
    code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/health" || true)
    [ "$code" = "200" ] && break
    sleep 1
  done
  if [ "$code" != "200" ]; then
    docker logs freeholder-recipe-gate
    echo "${target}: health endpoint returned ${code}"
    exit 1
  fi

  for _ in $(seq 1 60); do
    docker logs freeholder-recipe-gate 2>&1 | grep -q "demo installed" && break
    sleep 1
  done
  docker logs freeholder-recipe-gate 2>&1 | grep -q "demo installed"

  created=$(curl -sS -o /tmp/freeholder-recipe-owner.json -w '%{http_code}' \
    -H 'content-type: application/json' \
    -d "{\"email\":\"${OWNER_EMAIL}\",\"password\":\"${OWNER_PASSWORD}\"}" \
    "$BASE/api/setup/owner")
  [ "$created" = "201" ]

  set +e
  node scripts/doctor.mjs --url "$BASE" --email "$OWNER_EMAIL" \
    --password "$OWNER_PASSWORD" --json >/tmp/freeholder-recipe-doctor.json
  doctor_status=$?
  set -e
  if [ "$doctor_status" -gt 1 ]; then
    cat /tmp/freeholder-recipe-doctor.json
    exit "$doctor_status"
  fi
  node -e '
    const report = JSON.parse(require("fs").readFileSync("/tmp/freeholder-recipe-doctor.json", "utf8"));
    const failed = report.checks.filter((check) => check.verdict === "fail");
    if (failed.length) {
      console.error(failed.map((check) => `${check.id}: ${check.detail}`).join("\n"));
      process.exit(1);
    }
  '
  echo "${target}: image healthy; seeded setup claim and Doctor passed with no failures"
done
