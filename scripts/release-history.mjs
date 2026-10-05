// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Retain signed history across candidate and final releases (C10.03).
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { RELEASE_VERSION } from "../src/core/update/release-version.mjs";

export function previousFeedTag(pages) {
  if (!Array.isArray(pages) || pages.some((page) => !Array.isArray(page))) {
    throw new Error("Release history must contain paginated release lists.");
  }
  const releases = pages.flat().filter((release) =>
    !release.draft && RELEASE_VERSION.test(String(release.tag_name ?? "").replace(/^v/, "")) &&
    String(release.tag_name).startsWith("v") &&
    Array.isArray(release.assets) && release.assets.some((asset) => asset.name === "releases.json"));
  for (const release of releases) {
    if (!Number.isFinite(Date.parse(release.published_at))) {
      throw new Error(`Release ${release.tag_name} has no valid publication time.`);
    }
  }
  releases.sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at));
  return releases[0]?.tag_name ?? "";
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  console.log(previousFeedTag(JSON.parse(readFileSync(process.argv[2], "utf8"))));
}
