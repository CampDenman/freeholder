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
archive="/tmp/freeholder-${stamp}.dump"
checksum="${archive}.sha256"
cleanup() { rm -f "$archive" "$checksum"; }
trap cleanup EXIT

cd /opt/freeholder
# Custom format is checksummed and selectively inspectable. Restore into a new
# database; never use --clean against the running instance.
docker compose exec -T db pg_dump -U freeholder \
  --format=custom --no-owner --no-privileges freeholder > "$archive"

size=$(stat -c%s "$archive")
if [ "$size" -lt 1024 ]; then
  echo "backup: dump is only ${size} bytes — refusing to upload a likely-empty archive" >&2
  rm -f "$archive"
  exit 1
fi
cd /tmp
sha256sum "$(basename "$archive")" > "$checksum"

docker run --rm \
  -e AWS_ACCESS_KEY_ID="$S3_ACCESS_KEY_ID" \
  -e AWS_SECRET_ACCESS_KEY="$S3_SECRET_ACCESS_KEY" \
  -v "$archive:$archive:ro" \
  amazon/aws-cli:latest \
  s3 cp "$archive" "s3://${BACKUP_BUCKET}/db/$(basename "$archive")" \
  --endpoint-url "$S3_ENDPOINT"
docker run --rm \
  -e AWS_ACCESS_KEY_ID="$S3_ACCESS_KEY_ID" \
  -e AWS_SECRET_ACCESS_KEY="$S3_SECRET_ACCESS_KEY" \
  -v "$checksum:$checksum:ro" \
  amazon/aws-cli:latest \
  s3 cp "$checksum" "s3://${BACKUP_BUCKET}/db/$(basename "$checksum")" \
  --endpoint-url "$S3_ENDPOINT"

echo "backup: uploaded $(basename "$archive") and checksum (${size} bytes)"
