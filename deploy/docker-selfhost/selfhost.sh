#!/bin/sh
# Copyright (C) 2026 Tony Aly
# SPDX-License-Identifier: Apache-2.0
#
# C3.44: run the Docker Compose recipe with only Docker and openssl on the
# host: no Node, pnpm or `pnpm install`. Run it from anywhere in a checkout:
#
#   deploy/docker-selfhost/selfhost.sh prepare [--domain example.com] [--storage local|s3]
#   deploy/docker-selfhost/selfhost.sh start
#   deploy/docker-selfhost/selfhost.sh claim-link
#
# `pnpm launch:prepare --target docker-selfhost` writes the same .env and still
# works; this script exists so a server needs neither.
set -eu

here=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd -P)
ENV_FILE="$here/.env"
REPOSITORY="CampDenman/freeholder"

say() { printf 'freeholder: %s\n' "$*"; }
warn() { printf 'freeholder: warning: %s\n' "$*" >&2; }
die() { printf 'freeholder: error: %s\n' "$*" >&2; exit 1; }

env_get() { [ -f "$ENV_FILE" ] && sed -n "s/^$1=//p" "$ENV_FILE" | tail -n 1 | sed -e 's/^"//' -e 's/"$//' || true; }
env_set() {
  case "$2" in *[[:space:]\"\'\\]*) die "refusing to store a value for $1 with spaces, quotes or backslashes" ;; esac
  tmp="$ENV_FILE.tmp.$$"
  ( umask 077; if [ -f "$ENV_FILE" ]; then grep -v "^$1=" "$ENV_FILE" > "$tmp" || true; else : > "$tmp"; fi )
  printf '%s=%s\n' "$1" "$2" >> "$tmp"
  chmod 600 "$tmp"
  mv "$tmp" "$ENV_FILE"
}
ensure_secret() { [ -n "$(env_get "$1")" ] || env_set "$1" "$(openssl rand -hex 32)"; }

release_version() {
  sed -n 's/^  "version": "\(.*\)",$/\1/p' "$here/../../package.json" | head -n 1
}

compose_file() {
  case "$(env_get APP_URL)" in
    https://*) echo "$here/infra/compose.https.yml" ;;
    *) echo "$here/infra/compose.yml" ;;
  esac
}
compose() { docker compose --env-file "$ENV_FILE" -f "$(compose_file)" "$@"; }

private_ipv4() {
  case "$1" in
    10.*|192.168.*|127.*|169.254.*|172.1[6-9].*|172.2[0-9].*|172.3[01].*) return 0 ;;
    100.6[4-9].*|100.[7-9][0-9].*|100.1[01][0-9].*|100.12[0-7].*) return 0 ;;
  esac
  return 1
}
public_ipv4() {
  ip=$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for (i = 1; i < NF; i++) if ($i == "src") {print $(i + 1); exit}}' || true)
  if [ -z "$ip" ] || private_ipv4 "$ip"; then
    ip=$(curl -4 -fsS --max-time 10 https://checkip.amazonaws.com 2>/dev/null | tr -d '[:space:]' || true)
  fi
  case "$ip" in *.*.*.*) printf '%s\n' "$ip" ;; *) return 1 ;; esac
}
sslip_host() { printf '%s.sslip.io\n' "$(printf '%s' "$1" | tr . -)"; }

cmd_prepare() {
  domain="" storage="" local_only=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --domain) domain=$2; shift 2 ;;
      --storage) storage=$2; shift 2 ;;
      --localhost) local_only=1; shift ;;
      *) die "prepare: unknown option $1" ;;
    esac
  done
  command -v openssl >/dev/null 2>&1 || die "openssl is required"
  [ -f "$ENV_FILE" ] || { ( umask 077; : > "$ENV_FILE" ); }
  chmod 600 "$ENV_FILE"
  ensure_secret POSTGRES_PASSWORD
  ensure_secret BOOTSTRAP_SECRET
  ensure_secret SESSION_SECRET
  ensure_secret CREDENTIAL_KEY
  if [ -n "$local_only" ]; then
    env_set APP_URL http://localhost:3000
  elif [ -n "$domain" ] || [ -z "$(env_get FREEHOLDER_DOMAIN)" ]; then
    if [ -z "$domain" ]; then
      ip=$(public_ipv4) || die "could not find this server's public IPv4 address; pass --domain"
      domain=$(sslip_host "$ip")
      say "using the temporary address https://$domain (move to your domain later with: prepare --domain example.com && start)"
    fi
    env_set FREEHOLDER_DOMAIN "$domain"
    env_set APP_URL "https://$domain"
  fi
  [ -n "$(env_get FREEHOLDER_SEED_DEMO)" ] || env_set FREEHOLDER_SEED_DEMO 0
  [ -n "$(env_get FREEHOLDER_IMAGE)" ] || env_set FREEHOLDER_IMAGE "ghcr.io/campdenman/freeholder:$(release_version)"
  case "${storage:-$(env_get FREEHOLDER_STORAGE)}" in
    ""|local) env_set FREEHOLDER_STORAGE local ;;
    s3)
      env_set FREEHOLDER_STORAGE s3
      for name in S3_ENDPOINT S3_REGION S3_BUCKET S3_ACCESS_KEY_ID S3_SECRET_ACCESS_KEY; do
        [ -n "$(env_get "$name")" ] || warn "add $name to $ENV_FILE before starting"
      done ;;
    *) die "--storage is local or s3" ;;
  esac
  say "wrote $ENV_FILE (mode 600; secrets generated with openssl)"
  say "start it with: $0 start"
}

cmd_start() {
  [ -f "$ENV_FILE" ] || die "run '$0 prepare' first"
  # Release tags do not move, so pull only what is not here yet (a locally
  # built FREEHOLDER_IMAGE is never pulled).
  compose up -d --wait --pull missing
  url=$(env_get APP_URL)
  say "waiting for $url"
  i=0
  until curl -fsS --max-time 10 -o /dev/null "$url/api/health"; do
    i=$((i + 1)); [ "$i" -lt 60 ] || { warn "$url is not answering yet; check DNS and ports 80/443, then: $0 check"; break; }
    sleep 3
  done
  say "Your private owner claim link (open it yourself):"
  cmd_claim_link
}

cmd_claim_link() {
  url=$(env_get APP_URL); secret=$(env_get BOOTSTRAP_SECRET)
  [ -n "$url" ] && [ -n "$secret" ] || die "run '$0 prepare' first"
  printf '%s/setup#claim=%s\n' "$url" "$secret"
}

cmd_check() {
  failures=0
  url=$(env_get APP_URL)
  compose ps
  for service in app db backup; do
    state=$(docker inspect -f '{{.State.Status}}{{if .State.Health}}/{{.State.Health.Status}}{{end}}' "$(compose ps -q "$service")" 2>/dev/null || echo missing)
    case "$state" in running|running/healthy) printf '  ok    %s %s\n' "$service" "$state" ;; *) printf '  FAIL  %s %s\n' "$service" "$state"; failures=$((failures + 1)) ;; esac
  done
  if curl -fsS --max-time 15 -o /dev/null "$url/api/health"; then printf '  ok    %s/api/health\n' "$url"; else printf '  FAIL  %s/api/health\n' "$url"; failures=$((failures + 1)); fi
  latest=$(compose exec -T backup sh -c 'ls -1 /backups 2>/dev/null | grep -v partial | sort | tail -n 1' || true)
  printf '  info  latest backup: %s\n' "${latest:-none yet}"
  [ "$failures" -eq 0 ] || { echo "$failures check(s) failed. Logs: docker compose --env-file $ENV_FILE -f $(compose_file) logs app"; return 1; }
  echo "All checks passed."
}

cmd_backup() { compose exec -T backup sh /usr/local/bin/freeholder-backup now; }

cmd_restore() {
  [ $# -eq 1 ] || die "usage: $0 restore NAME (see: $0 backups)"
  name=$1
  [ "$name" != latest ] || name=$(compose exec -T backup sh -c 'ls -1 /backups | grep -v partial | sort | tail -n 1')
  say "taking a safety backup first"
  cmd_backup
  compose stop app
  compose exec -T backup sh /usr/local/bin/freeholder-backup restore "$name" || { compose start app; die "restore failed; the current data was kept"; }
  compose start app
  compose up -d --wait app
  say "restored $name"
}

cmd_update() {
  [ $# -eq 1 ] || die "usage: $0 update VERSION (see https://github.com/$REPOSITORY/releases)"
  version=${1#v}
  case "$version" in *[!0-9A-Za-z.-]*) die "not a release version: $version" ;; esac
  previous=$(env_get FREEHOLDER_IMAGE)
  say "backing up before the update"
  cmd_backup
  env_set PREVIOUS_FREEHOLDER_IMAGE "$previous"
  env_set FREEHOLDER_IMAGE "ghcr.io/campdenman/freeholder:$version"
  compose pull --quiet app
  if compose up -d --wait app; then
    say "updated to $version; previous image kept as PREVIOUS_FREEHOLDER_IMAGE"
  else
    warn "$version did not become healthy; switching back to $previous"
    env_set FREEHOLDER_IMAGE "$previous"
    compose up -d --wait app
    die "update failed; restore the pre-update backup if it had migrated the database: $0 restore NAME"
  fi
}

usage() {
  cat <<USAGE
Usage: $0 COMMAND
  prepare [--domain NAME] [--storage local|s3] [--localhost]
                 write deploy/docker-selfhost/.env (secrets from openssl)
  start          pull the release image, start, print the claim link
  claim-link     print the private owner claim link
  check          container health, /api/health over HTTPS, latest backup
  backup         back up the database and media now (also runs nightly)
  backups        list backups
  restore NAME   restore a backup (or 'latest'), after a safety backup
  update VERSION switch to a release image, backing up first
USAGE
}

command=${1:-help}
[ $# -eq 0 ] || shift
case "$command" in
  prepare) cmd_prepare "$@" ;;
  start) cmd_start ;;
  claim-link) cmd_claim_link ;;
  check|status) cmd_check ;;
  backup) cmd_backup ;;
  backups) compose exec -T backup ls -1 /backups ;;
  restore) cmd_restore "$@" ;;
  update) cmd_update "$@" ;;
  logs) compose logs -f app ;;
  *) usage ;;
esac
