// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Provider-neutral migration contract used by the real database drill and
// every Tier-1 deployment recipe (C3.18, C3.19).
import { EXPORT_FORMAT } from "./ownership-export.mjs";

export const TIER1_TARGETS = [
  "replit",
  "digitalocean-app",
  "digitalocean-droplet",
  "railway",
  "render",
  "docker-selfhost",
] as const;

export type Tier1Target = (typeof TIER1_TARGETS)[number];

export const MIGRATION_INVARIANTS = [
  "ids",
  "money",
  "timestamps",
  "media",
  "locales",
  "public-urls",
] as const;

export const MIGRATION_ARTIFACTS = {
  database: "postgres-custom-v1",
  logical: EXPORT_FORMAT,
  media: "freeholder-media-manifest/v1",
  configuration: "freeholder-config/v1",
} as const;

export type MigrationContract = {
  id: `${Tier1Target}->${Tier1Target}`;
  from: Tier1Target;
  to: Tier1Target;
  artifacts: typeof MIGRATION_ARTIFACTS;
  invariants: typeof MIGRATION_INVARIANTS;
};

export function tier1Pairs(): Array<[Tier1Target, Tier1Target]> {
  const pairs: Array<[Tier1Target, Tier1Target]> = [];
  for (const from of TIER1_TARGETS) {
    for (const to of TIER1_TARGETS) {
      if (from !== to) pairs.push([from, to]);
    }
  }
  return pairs;
}

export function migrationContract(
  from: Tier1Target,
  to: Tier1Target,
): MigrationContract {
  if (from === to) {
    throw new Error("A Tier-1 migration must name two different targets.");
  }
  return {
    id: `${from}->${to}`,
    from,
    to,
    artifacts: MIGRATION_ARTIFACTS,
    invariants: MIGRATION_INVARIANTS,
  };
}

export const RECIPE_OPERATIONS = [
  "install",
  "verify",
  "backup",
  "restore",
  "migrate-in",
  "migrate-out",
  "update",
  "rollback",
] as const;
