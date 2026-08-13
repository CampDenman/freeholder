#!/usr/bin/env bash
# Copyright (C) 2026 Tony Aly
# SPDX-License-Identifier: Apache-2.0
# Nightly database backup to a versioned Spaces bucket (§21b).
#
# Media is already in Spaces, so this covers the other half: the database. A
# self-host recipe without a tested restore path is a liability, which is why
# verify.md rehearses the restore rather than trusting this script exists.
set -euo pipefail

: "${BACKUP_BUCKET:?set BACKUP_BUCKET, e.g. freeholder-backups}"
: "${S3_ENDPOINT:?set S3_ENDPOINT}"
: "${S3_ACCESS_KEY_ID:?}"
: "${S3_SECRET_ACCESS_KEY:?}"

stamp="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
archive="/tmp/freeholder-${stamp}.sql.gz"

cd /opt/freeholder
# --clean --if-exists so the dump restores over an existing database without
# needing it dropped first.
docker compose exec -T db pg_dump -U freeholder --clean --if-exists freeholder \
  | gzip -9 > "$archive"

size=$(stat -c%s "$archive")
if [ "$size" -lt 1024 ]; then
  echo "backup: dump is only ${size} bytes — refusing to upload a likely-empty archive" >&2
  rm -f "$archive"
  exit 1
fi

docker run --rm \
  -e AWS_ACCESS_KEY_ID="$S3_ACCESS_KEY_ID" \
  -e AWS_SECRET_ACCESS_KEY="$S3_SECRET_ACCESS_KEY" \
  -v "$archive:$archive:ro" \
  amazon/aws-cli:latest \
  s3 cp "$archive" "s3://${BACKUP_BUCKET}/db/$(basename "$archive")" \
  --endpoint-url "$S3_ENDPOINT"

rm -f "$archive"
echo "backup: uploaded $(basename "$archive") (${size} bytes)"
