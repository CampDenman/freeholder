#!/bin/bash
# Copyright (C) 2026 Tony Aly
# SPDX-License-Identifier: Apache-2.0
# Swap the droplet's pinned image. The caller has already checked provenance.
#
#   bash -s -- <pin> <dir> <attempts> <pause-seconds>
#
# A failed health check must not automatically roll back. Migrations in the
# new image may already have landed, and the previous image can then be
# unable to read the schema (deploy/update-apply.md). The previous digest
# pin is recorded and left for an operator.
set -euo pipefail

pin="${1:?pin}"
dir="${2:?dir}"
attempts="${3:-90}"
pause="${4:-2}"

if [[ ! "$pin" =~ ^ghcr\.io/campdenman/freeholder@sha256:[a-f0-9]{64}$ ]]; then
  echo "refusing to pin anything other than ghcr.io/campdenman/freeholder@sha256:<64 hex>" >&2
  exit 2
fi
if [[ ! "$dir" =~ ^/[A-Za-z0-9._/-]+$ || "$dir" == *..* ]]; then
  echo "refusing deploy directory" >&2
  exit 2
fi
if [[ ! "$attempts" =~ ^[1-9][0-9]{0,2}$ ]]; then
  echo "refusing attempt count" >&2
  exit 2
fi
if [[ ! "$pause" =~ ^(0|[1-9][0-9]{0,2})$ ]]; then
  echo "refusing pause" >&2
  exit 2
fi

cd "$dir"
test -f compose.yml
test -f .env
if ! grep -q '^POSTGRES_PASSWORD=.' .env; then
  echo "refusing to edit .env: POSTGRES_PASSWORD is empty" >&2
  exit 2
fi
if ! grep -q '^FREEHOLDER_DOMAIN=.' .env; then
  echo "refusing to edit .env: FREEHOLDER_DOMAIN is empty" >&2
  exit 2
fi

current="$(awk -F= '/^FREEHOLDER_IMAGE=/{print substr($0, index($0,"=")+1); exit}' .env)"
current="${current//$'\r'/}"
if [[ "$current" == "$pin" ]]; then
  echo "already pinned"
  exit 0
fi

previous=""
if [[ "$current" =~ ^ghcr\.io/campdenman/freeholder@sha256:[a-f0-9]{64}$ ]]; then
  previous="$current"
fi

# backup.sh reads the environment. Source it in a subshell so a dump of this
# script's own output cannot include the secrets, and so a failed backup
# returns before .env changes.
if [[ ! -f backup.sh ]]; then
  echo "refusing to swap: backup.sh is not beside compose.yml" >&2
  exit 2
fi
backup_log="$(mktemp)"
cleanup_log() { rm -f -- "$backup_log"; }
trap cleanup_log EXIT
if ! (
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
  bash ./backup.sh
) >"$backup_log" 2>&1; then
  echo "backup failed; the image pin was not changed" >&2
  exit 1
fi
if ! grep -Eq '^backup: uploaded freeholder-.+\.dump and checksum \([0-9]+ bytes\)$' "$backup_log"; then
  echo "backup did not report an upload; the image pin was not changed" >&2
  exit 1
fi
echo "backup: database archive uploaded before the image swap"
rm -f -- "$backup_log"
trap - EXIT

tmp="$(mktemp "${dir}/.env.deploy.XXXXXX")"
cleanup_tmp() { rm -f -- "$tmp"; }
trap cleanup_tmp EXIT
awk -v pin="$pin" -v previous="$previous" '
BEGIN { saw_pin = 0; saw_prev = 0 }
/^FREEHOLDER_IMAGE=/ {
  print "FREEHOLDER_IMAGE=" pin
  saw_pin = 1
  next
}
/^PREVIOUS_FREEHOLDER_IMAGE=/ {
  if (previous != "") {
    print "PREVIOUS_FREEHOLDER_IMAGE=" previous
    saw_prev = 1
  } else {
    print
  }
  next
}
{ print }
END {
  if (!saw_pin) print "FREEHOLDER_IMAGE=" pin
  if (previous != "" && !saw_prev) print "PREVIOUS_FREEHOLDER_IMAGE=" previous
}
' .env > "$tmp"
chmod 600 "$tmp"
mv "$tmp" .env
trap - EXIT

since="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
docker compose pull
docker compose up -d

ready=0
for _ in $(seq 1 "$attempts"); do
  logs="$(docker compose logs --since "$since" app 2>&1 || true)"
  if printf '%s\n' "$logs" | grep -F "[freeholder] migrations skipped:" >/dev/null; then
    echo "migrations did not run; not rolling back" >&2
    exit 1
  fi
  if printf '%s\n' "$logs" | grep -F "[freeholder] schema is up to date" >/dev/null; then
    ready=1
    break
  fi
  sleep "$pause"
done
if [[ "$ready" != 1 ]]; then
  echo "the new process did not report that the schema is up to date; not rolling back" >&2
  exit 1
fi
echo "schema is up to date"
