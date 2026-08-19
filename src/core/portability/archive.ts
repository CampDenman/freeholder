// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Logical archive used for Tier-1 pair round-trips (C3.18, C3.19).
import { createHash } from "node:crypto";
import { EXPORT_FORMAT } from "../../../scripts/ownership-export.mjs";

export const TIER1_TARGETS = [
  "replit",
  "digitalocean-app",
  "digitalocean-droplet",
  "railway",
  "render",
  "docker-selfhost",
] as const;

export type Tier1Target = (typeof TIER1_TARGETS)[number];

export type LogicalBusiness = {
  ids: Record<string, string>;
  money: Array<{ invoiceId: string; amountCents: number; currency: string }>;
  timestamps: Record<string, string>;
  media: Array<{ id: string; key: string; sha256: string }>;
  locales: string[];
  urls: string[];
};

export type LogicalArchive = {
  format: string;
  from?: Tier1Target;
  to?: Tier1Target;
  checksum: string;
  business: LogicalBusiness;
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

export function checksumBusiness(business: LogicalBusiness): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(business)).digest("hex")}`;
}

export function buildLogicalArchive(
  business: LogicalBusiness,
  pair?: { from: Tier1Target; to: Tier1Target },
): LogicalArchive {
  return {
    format: EXPORT_FORMAT,
    from: pair?.from,
    to: pair?.to,
    checksum: checksumBusiness(business),
    business: structuredClone(business),
  };
}

export function applyLogicalArchive(archive: LogicalArchive): LogicalBusiness {
  if (archive.format !== EXPORT_FORMAT) {
    throw new Error(`Unknown export format ${archive.format}.`);
  }
  if (archive.checksum !== checksumBusiness(archive.business)) {
    throw new Error("That archive checksum does not match its contents.");
  }
  return structuredClone(archive.business);
}

export function archivePreserves(before: LogicalBusiness, after: LogicalBusiness): string[] {
  const problems: string[] = [];
  if (JSON.stringify(before.ids) !== JSON.stringify(after.ids)) {
    problems.push("IDs changed");
  }
  if (JSON.stringify(before.money) !== JSON.stringify(after.money)) {
    problems.push("money changed");
  }
  if (JSON.stringify(before.timestamps) !== JSON.stringify(after.timestamps)) {
    problems.push("timestamps changed");
  }
  if (JSON.stringify(before.media) !== JSON.stringify(after.media)) {
    problems.push("media changed");
  }
  if (JSON.stringify(before.locales) !== JSON.stringify(after.locales)) {
    problems.push("locales changed");
  }
  if (JSON.stringify(before.urls) !== JSON.stringify(after.urls)) {
    problems.push("public URLs changed");
  }
  return problems;
}

export const RECIPE_STEPS = [
  "install",
  "verify",
  "backup",
  "restore",
  "migrate-in",
  "migrate-out",
  "update",
  "rollback",
] as const;
