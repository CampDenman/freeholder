#!/bin/sh
# Copyright (C) 2026 Tony Aly
# SPDX-License-Identifier: Apache-2.0
#
# Install Freeholder on a plain Ubuntu or Debian server, without Docker (C3.44).
#
#   curl -fsSLO https://github.com/CampDenman/freeholder/releases/download/vVERSION/install.sh
#   sudo sh install.sh                        # asks for your domain, or uses a temporary address
#   sudo sh install.sh --domain example.com   # no questions
#
# Read it first; it is meant to be read. What it does, in order:
#   1. Installs PostgreSQL (distribution package, or the official PostgreSQL
#      apt repository when the distribution's is older than 15), Caddy (the
#      official Caddy apt repository), curl and openssl.
#   2. Creates a `freeholder` system user.
#   3. Downloads the release tarball for this machine (it bundles its own
#      Node.js runtime), checks its SHA-256, and unpacks it to
#      /opt/freeholder/releases/VERSION with /opt/freeholder/current pointing
#      at it.
#   4. Hands over to `freeholder setup` from that release, which creates the
#      database, generates secrets with openssl into /etc/freeholder (mode 640),
#      writes the systemd units, the Caddyfile and the nightly backup timer,
#      starts everything and prints your private claim link.
#
# Running it again is safe: it keeps existing secrets, data and settings.
# Everything it creates is listed in deploy/linux/README.md, including how to
# remove it.
set -eu

# Bumped with every release (tests/core/linux-install.test.ts checks it
# matches package.json), so a downloaded install.sh installs its own release.
FREEHOLDER_VERSION_DEFAULT="0.2.0-beta.4"
REPOSITORY="CampDenman/freeholder"

say() { printf 'freeholder: %s\n' "$*"; }
die() { printf 'freeholder: error: %s\n' "$*" >&2; exit 1; }

usage() {
  cat <<'USAGE'
Usage: sudo sh install.sh [options]

  --domain NAME      The site's domain. Without it you are asked, and an empty
                     answer uses a temporary https://<ip>.sslip.io address
                     until you run `freeholder domain NAME`.
  --email ADDRESS    Optional address Let's Encrypt may contact about the
                     certificate.
  --storage local|s3 Where uploaded media lives (default: local, on this
                     server under /var/lib/freeholder/media, included in the
                     nightly backup). s3 asks for a bucket and key.
  --version VERSION  Release to install (default: this script's release).
  --tarball FILE     Install from a downloaded tarball; FILE.sha256 must sit
                     beside it.
  --yes              Never ask; use defaults for anything not given.
  --help             Show this.
USAGE
}

version="$FREEHOLDER_VERSION_DEFAULT"
tarball=""
setup_args=""
while [ $# -gt 0 ]; do
  case "$1" in
    --domain|--email|--storage)
      [ $# -ge 2 ] || die "$1 needs a value"
      setup_args="$setup_args $1 $2"; shift 2 ;;
    --version) [ $# -ge 2 ] || die "--version needs a value"; version="${2#v}"; shift 2 ;;
    --tarball) [ $# -ge 2 ] || die "--tarball needs a file"; tarball="$2"; shift 2 ;;
    --yes) setup_args="$setup_args --yes"; shift ;;
    --help|-h) usage; exit 0 ;;
    *) die "unknown option $1 (see --help)" ;;
  esac
done
case "$version" in
  *[!0-9A-Za-z.-]*|"") die "not a release version: $version" ;;
esac

[ "$(id -u)" = 0 ] || die "run it as root: sudo sh install.sh"
[ -r /etc/os-release ] || die "this installer supports Ubuntu and Debian"
. /etc/os-release
case "${ID:-} ${ID_LIKE:-}" in
  *ubuntu*|*debian*) ;;
  *) die "this installer supports Ubuntu and Debian (found ${PRETTY_NAME:-unknown}); see deploy/README.md for other hosts" ;;
esac
command -v systemctl >/dev/null 2>&1 || die "systemd is required"
case "$(uname -m)" in
  x86_64|amd64) arch=x64 ;;
  aarch64|arm64) arch=arm64 ;;
  *) die "release tarballs exist for x86_64 and arm64, not $(uname -m)" ;;
esac
memory_kb=$(awk '/^MemTotal:/ {print $2}' /proc/meminfo)
if [ "${memory_kb:-0}" -lt 1800000 ]; then
  say "warning: this server has less than 2 GB of memory; Freeholder and PostgreSQL need about 1 GB together and more as the site grows."
fi

export DEBIAN_FRONTEND=noninteractive
apt_updated=""
apt_update() { [ -n "$apt_updated" ] || { apt-get update -q; apt_updated=1; }; }
apt_install() { apt_update; apt-get install -y -q --no-install-recommends "$@"; }

say "installing curl, openssl and PostgreSQL"
apt_install ca-certificates curl openssl gnupg tar gzip postgresql-common

# PostgreSQL 15 or newer. Ubuntu 24.04 and Debian 12 ship it; older releases
# use the PostgreSQL project's own apt repository, set up by the script that
# Debian's postgresql-common package provides for exactly this.
pg_package=postgresql
candidate=$(apt-cache policy postgresql | awk '/Candidate:/ {print $2}')
candidate_major=${candidate%%+*}
case "$candidate_major" in
  ''|*[!0-9]*) candidate_major=0 ;;
esac
if [ "$candidate_major" -lt 15 ]; then
  say "this distribution's PostgreSQL is older than 15; adding the official PostgreSQL apt repository"
  /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y
  apt_updated=""
  pg_package=postgresql-16
fi
apt_install "$pg_package"
systemctl enable --now postgresql >/dev/null

if ! command -v caddy >/dev/null 2>&1; then
  say "installing Caddy from its official apt repository"
  keyring=/usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --batch --yes --dearmor -o "$keyring"
  chmod 644 "$keyring"
  curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
  apt_updated=""
  apt_install caddy
fi

if ! id freeholder >/dev/null 2>&1; then
  say "creating the freeholder system user"
  useradd --system --user-group --home-dir /var/lib/freeholder --shell /usr/sbin/nologin freeholder
fi
install -d -m 755 -o root -g root /opt/freeholder /opt/freeholder/releases

name="freeholder-${version}-linux-${arch}"
release="/opt/freeholder/releases/${version}"
if [ ! -x "$release/bin/freeholder" ]; then
  work=$(mktemp -d)
  trap 'rm -rf "$work"' EXIT
  if [ -n "$tarball" ]; then
    [ -f "$tarball" ] && [ -f "$tarball.sha256" ] || die "--tarball needs FILE and FILE.sha256"
    cp "$tarball" "$work/$name.tar.gz"
    cp "$tarball.sha256" "$work/$name.tar.gz.sha256"
  else
    base="https://github.com/${REPOSITORY}/releases/download/v${version}"
    say "downloading $name"
    curl -fsSL --retry 3 -o "$work/$name.tar.gz" "$base/$name.tar.gz"
    curl -fsSL --retry 3 -o "$work/$name.tar.gz.sha256" "$base/$name.tar.gz.sha256"
  fi
  expected=$(awk '{print $1; exit}' "$work/$name.tar.gz.sha256")
  actual=$(sha256sum "$work/$name.tar.gz" | awk '{print $1}')
  [ -n "$expected" ] && [ "$expected" = "$actual" ] || die "checksum mismatch for $name.tar.gz; nothing was installed"
  say "checksum verified ($actual)"
  tar -xzf "$work/$name.tar.gz" -C "$work"
  top=$(tar -tzf "$work/$name.tar.gz" | head -1 | cut -d/ -f1)
  [ -x "$work/$top/bin/freeholder" ] && [ -x "$work/$top/runtime/node/bin/node" ] || die "the tarball is not a Freeholder release"
  rm -rf "$release.partial"
  mv "$work/$top" "$release.partial"
  chown -R root:root "$release.partial"
  mv "$release.partial" "$release"
  rm -rf "$work"
  trap - EXIT
fi
if [ ! -e /opt/freeholder/current ]; then
  ln -sfn "releases/${version}" /opt/freeholder/current.new
  mv -T /opt/freeholder/current.new /opt/freeholder/current
fi
ln -sfn /opt/freeholder/current/bin/freeholder /usr/local/bin/freeholder

# shellcheck disable=SC2086 # setup_args is a list of words built above.
exec "$release/bin/freeholder" setup $setup_args
