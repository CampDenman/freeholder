#!/bin/sh
# shellcheck disable=SC2010 # the listed names are our own timestamps.
# Copyright (C) 2026 Tony Aly
# SPDX-License-Identifier: Apache-2.0
# C3.44: the docker-selfhost backup service (postgres:16-alpine, so pg_dump
# matches the database). Each backup is /backups/<UTC stamp>/ with
# database.dump (custom format), media.tar.gz (the media volume) and
# SHA256SUMS, the same layout as the Linux recipe's `freeholder backup`.
#
#   schedule   run forever, one backup a day at BACKUP_HOUR_UTC:15
#   now        one backup
#   restore X  restore backup X (the app must be stopped; selfhost.sh does it)
set -eu

keep=${BACKUP_KEEP:-14}
case "$keep" in ''|*[!0-9]*) echo "backup: BACKUP_KEEP must be a number" >&2; exit 1 ;; esac

backup_now() {
  stamp=$(date -u +%Y-%m-%dT%H-%M-%SZ)
  dir="/backups/$stamp"
  rm -rf "$dir.partial"
  mkdir -p "$dir.partial"
  chmod 700 /backups "$dir.partial"
  pg_dump --format=custom --no-owner --no-privileges > "$dir.partial/database.dump"
  size=$(stat -c %s "$dir.partial/database.dump")
  if [ "$size" -lt 1024 ]; then
    rm -rf "$dir.partial"
    echo "backup: the database dump is only $size bytes; refusing to keep a likely-empty backup" >&2
    return 1
  fi
  if [ -n "$(ls -A /srv/media 2>/dev/null)" ]; then
    tar -C /srv -czf "$dir.partial/media.tar.gz" media
  fi
  (cd "$dir.partial" && sha256sum ./* > SHA256SUMS)
  mv "$dir.partial" "$dir"
  echo "backup: $stamp ($(du -sh "$dir" | cut -f1))"
  ls -1 /backups | grep -E '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9-]+Z$' | sort | head -n "-$keep" | while read -r old; do
    rm -rf "/backups/$old"
  done
}

restore() {
  dir="/backups/$1"
  [ -f "$dir/database.dump" ] || { echo "restore: no backup named $1" >&2; exit 1; }
  (cd "$dir" && sha256sum -c -s SHA256SUMS) || { echo "restore: $1 failed its checksum; nothing was changed" >&2; exit 1; }
  export PGOPTIONS="--client-min-messages=warning"
  dropdb --if-exists freeholder_restore
  createdb freeholder_restore
  if ! pg_restore --no-owner --no-privileges --exit-on-error -d freeholder_restore "$dir/database.dump"; then
    dropdb --if-exists freeholder_restore
    echo "restore: pg_restore failed; the current database was not changed" >&2
    exit 1
  fi
  dropdb --if-exists freeholder_previous
  psql -v ON_ERROR_STOP=1 -qtA -d postgres <<'SQL'
SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'freeholder' AND pid <> pg_backend_pid();
ALTER DATABASE freeholder RENAME TO freeholder_previous;
ALTER DATABASE freeholder_restore RENAME TO freeholder;
SQL
  # The media volume becomes exactly what the backup held (empty if it held
  # none, as with S3 storage, where the volume is unused).
  find /srv/media -mindepth 1 -delete
  [ ! -f "$dir/media.tar.gz" ] || tar -C /srv -xzf "$dir/media.tar.gz"
  echo "restore: $1 restored; the replaced database is kept as freeholder_previous"
}

case "${1:-}" in
  now) backup_now ;;
  restore) [ $# -eq 2 ] || { echo "usage: restore NAME" >&2; exit 2; }; restore "$2" ;;
  schedule)
    hour=${BACKUP_HOUR_UTC:-3}
    while :; do
      now=$(date -u +%s)
      next=$(date -u -d "@$(( now - now % 86400 + hour * 3600 + 900 ))" +%s)
      [ "$next" -gt "$now" ] || next=$(( next + 86400 ))
      echo "backup: next backup at $(date -u -d "@$next" +%Y-%m-%dT%H:%MZ)"
      sleep $(( next - now ))
      backup_now || echo "backup: failed; will try again tomorrow" >&2
    done ;;
  *) echo "usage: backup.sh schedule|now|restore NAME" >&2; exit 2 ;;
esac
