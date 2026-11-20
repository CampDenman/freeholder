#!/usr/bin/env bash
# Copyright (C) 2026 Tony Aly
# SPDX-License-Identifier: Apache-2.0
set -euo pipefail

if [[ $# != 4 || ( $1 != --check && $1 != --apply ) ]]; then
  echo "usage: $0 --check|--apply BARE_CACHE UPSTREAM_URL MIRROR_URL" >&2
  exit 2
fi

mode=$1
cache=$2
upstream_url=$3
mirror_url=$4
export GIT_TERMINAL_PROMPT=0

git_cache() {
  git --no-replace-objects -C "$cache" "$@"
}

if [[ $(git_cache rev-parse --is-bare-repository) != true ||
      $(git_cache rev-parse --is-shallow-repository) != false ]]; then
  echo "Use a dedicated, non-shallow bare Git cache." >&2
  exit 2
fi

# Isolate simultaneous checks and updates using this cache. The push lease
# also protects against writers that use another checkout or machine.
exec 9>"$cache/freeholder-mirror.lock"
if ! flock -n 9; then
  echo "Another mirror run holds the cache lock." >&2
  exit 2
fi

branch=refs/heads/main
upstream_ref=refs/freeholder-mirror/upstream
mirror_ref=refs/freeholder-mirror/mirror
git_cache fetch --no-tags --no-recurse-submodules -- "$upstream_url" "$branch:$upstream_ref"
git_cache fetch --no-tags --no-recurse-submodules -- "$mirror_url" "$branch:$mirror_ref"
upstream=$(git_cache rev-parse --verify "$upstream_ref^{commit}")
mirror=$(git_cache rev-parse --verify "$mirror_ref^{commit}")
counts=$(git_cache rev-list --left-right --count "$upstream...$mirror")
read -r behind ahead <<< "$counts"
printf 'upstream=%s mirror=%s behind=%s ahead=%s\n' "$upstream" "$mirror" "$behind" "$ahead"

if [[ $ahead != 0 ]]; then
  echo "Mirror main contains commits absent from upstream main. Preserving both histories." >&2
  exit 2
fi
if [[ $behind == 0 ]]; then
  echo "Mirror main is current."
  exit 0
fi
if [[ $mode == --check ]]; then
  echo "Mirror main is behind and can fast-forward." >&2
  exit 1
fi

# With zero mirror-only commits, the observed mirror tip is an ancestor of
# the exact source SHA. The explicit lease lets Git update only that observed
# tip, even if another writer advances, rewinds or deletes main after fetch.
git_cache push --no-follow-tags --force-with-lease="$branch:$mirror" -- \
  "$mirror_url" "$upstream:$branch"
printf 'Mirror main fast-forwarded to %s.\n' "$upstream"
