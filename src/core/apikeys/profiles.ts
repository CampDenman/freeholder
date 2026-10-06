// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.39: explicit presets, projected onto this instance's permitted registry.
export const CONNECTION_PROFILES = ["read", "website", "health"] as const;
export type ConnectionProfile = typeof CONNECTION_PROFILES[number];
const CONTENT_READ_AREAS = new Set(["cms", "entities", "media", "seo"]);
const WEBSITE_WRITES = new Set([
  "cms.createPage", "cms.updatePage", "cms.publishPage", "cms.mergePage",
  "cms.createSection", "cms.updateSection", "cms.createSectionLocale", "cms.restoreRevision",
  "media.setAltText",
]);
const HEALTH_SERVICES = new Set([
  "platform.doctor", "platform.updateStatus", "platform.listAvailableReleases",
  "platform.describeRelease", "platform.describeUpdateTargets", "platform.forkStatus",
]);

export function connectionScopes(profile: ConnectionProfile, services: Iterable<{ name: string; kind: "query" | "mutation" }>): string[] {
  if (!CONNECTION_PROFILES.includes(profile)) throw new Error("Unknown connection profile.");
  return [...services].filter(({ name, kind }) => {
    if (profile === "health") return HEALTH_SERVICES.has(name);
    if (kind === "query" && CONTENT_READ_AREAS.has(name.split(".")[0]!)) return true;
    return profile === "website" && WEBSITE_WRITES.has(name);
  }).map(({ name }) => name).sort();
}
