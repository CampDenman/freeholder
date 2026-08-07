#!/usr/bin/env bash
# Copyright (C) 2026 Tony Aly
# SPDX-License-Identifier: AGPL-3.0-only
#
# The upgrade gate (MASTER.md §15.8, §39.9).
#
# §39 promises an instance can keep itself patched unattended: apply, verify,
# and roll back by swapping the image with no database restore. Every other
# part of that design reduces the blast radius of a bad upgrade. This is the
# only part that checks an upgrade *works* — and it checks it the way an owner
# would experience it, with the released image, a database that already has
# their data in it, and no help from the repository.
#
# Four claims, in order:
#   1. the previously released image boots and migrates from nothing
#   2. this build migrates that database forward and serves requests
#   3. the data written by the old release is still there afterwards
#   4. the old release still runs against the new schema — which is what makes
#      rollback an image swap instead of a restore (§39.5)
#
# Claim 4 is the one that would otherwise be discovered by an owner at 3am.
set -euo pipefail

PREVIOUS_IMAGE="${PREVIOUS_IMAGE:?set PREVIOUS_IMAGE}"
# Registry names are lowercase, and `github.repository` is not: this repository
# is CampDenman/freeholder, so the obvious `ghcr.io/${{ github.repository }}`
# produces a reference that cannot be pulled. The publish workflow never hit it
# because docker/metadata-action lowercases for you. Caught on this gate's
# first run, by the skip being loud rather than silent.
PREVIOUS_IMAGE="$(printf '%s' "$PREVIOUS_IMAGE" | tr '[:upper:]' '[:lower:]')"
CURRENT_IMAGE="${CURRENT_IMAGE:?set CURRENT_IMAGE}"
DB="${UPGRADE_DB:-freeholder_upgrade}"
PORT="${UPGRADE_PORT:-3100}"
PGHOST="${PGHOST:-localhost}"
PGUSER="${PGUSER:-postgres}"
export PGPASSWORD="${PGPASSWORD:-postgres}"

URL="postgres://${PGUSER}:${PGPASSWORD}@${PGHOST}:5432/${DB}"
SECRET="upgrade-gate-secret-that-is-32-chars-long"
MARKER="upgrade-gate@example.test"

cleanup() { docker rm -f fh-upgrade >/dev/null 2>&1 || true; }
trap cleanup EXIT

psql_db() { psql -h "$PGHOST" -U "$PGUSER" -d "$DB" -tA -c "$1"; }

# A released image to upgrade *from* is the whole premise. On the very first
# run of a fresh repository there is none, and failing then would mean a red
# tick nobody can fix. Skipped loudly rather than passed quietly — a gate that
# silently does nothing is worse than no gate.
if ! docker pull "$PREVIOUS_IMAGE" >/dev/null 2>&1; then
  echo "::warning title=Upgrade gate skipped::No previously published image at ${PREVIOUS_IMAGE}. Nothing to upgrade from; §39.9 is not being checked on this run."
  exit 0
fi

previous_digest=$(docker image inspect "$PREVIOUS_IMAGE" --format '{{index .RepoDigests 0}}' 2>/dev/null || echo "$PREVIOUS_IMAGE")
echo "Upgrading from: ${previous_digest}"

# Its own database. The suite's has already been migrated to HEAD, and the
# point here is to start from the schema an owner is actually running.
psql -h "$PGHOST" -U "$PGUSER" -d postgres -c "drop database if exists ${DB}" >/dev/null
psql -h "$PGHOST" -U "$PGUSER" -d postgres -c "create database ${DB}" >/dev/null

boot() {
  local image="$1" name="$2" skip_migrate="${3:-0}"
  docker run -d --name fh-upgrade --network host \
    -e SESSION_SECRET="$SECRET" \
    -e APP_URL="http://localhost:${PORT}" \
    -e PORT="$PORT" \
    -e DATABASE_URL="$URL" \
    -e FREEHOLDER_SKIP_MIGRATE="$skip_migrate" \
    "$image" >/dev/null

  local code=""
  for _ in $(seq 1 60); do
    code=$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:${PORT}/api/health" || true)
    [ "$code" = "200" ] && break
    sleep 1
  done
  if [ "$code" != "200" ]; then
    echo "::error title=Upgrade gate::${name} did not become healthy (last status ${code})"
    docker logs fh-upgrade
    exit 1
  fi
  local health
  health=$(curl -s "http://localhost:${PORT}/api/health")
  echo "  ${name}: ${health}"
  echo "$health" | grep -q '"ok":true' || {
    echo "::error title=Upgrade gate::${name} answered health without ok:true"
    docker logs fh-upgrade
    exit 1
  }
}

echo "1. the previous release boots and migrates an empty database"
boot "$PREVIOUS_IMAGE" "previous release"

echo "2. writing data through the schema that release created"
# Written with SQL rather than through the UI on purpose: the claim under test
# is that *migrations* preserve data, and driving forms would make a failure
# here ambiguous between the two.
psql_db "insert into contacts (name, email) values ('Upgrade Gate', '${MARKER}')" >/dev/null
before=$(psql_db "select count(*) from contacts where email = '${MARKER}'")
[ "$before" = "1" ] || { echo "::error::could not seed the previous release's schema"; exit 1; }
cleanup

echo "3. this build migrates that database forward and serves requests"
boot "$CURRENT_IMAGE" "this build"

echo "4. the data survived the migration"
after=$(psql_db "select count(*) from contacts where email = '${MARKER}'")
if [ "$after" != "1" ]; then
  echo "::error title=Upgrade gate::a contact written by the previous release did not survive the upgrade (found ${after})"
  exit 1
fi
home=$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:${PORT}/" || true)
[ "$home" = "200" ] || { echo "::error title=Upgrade gate::home page answered ${home} after upgrade"; docker logs fh-upgrade; exit 1; }
cleanup

echo "5. the previous release still runs against the new schema (rollback)"
# FREEHOLDER_SKIP_MIGRATE=1 because that is what a rollback does: it swaps the
# image back and leaves the schema where it is. If the old release cannot read
# the new schema, rollback is a database restore — which is the difference
# between an updater an owner can leave on and one they cannot.
boot "$PREVIOUS_IMAGE" "previous release, new schema" 1
rolled_back=$(psql_db "select count(*) from contacts where email = '${MARKER}'")
[ "$rolled_back" = "1" ] || { echo "::error title=Upgrade gate::data unreadable after rollback"; exit 1; }

echo "Upgrade gate: upgrade and rollback both clean."
