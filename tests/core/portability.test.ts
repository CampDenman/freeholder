// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The pair matrix binds each platform pair to the artifacts exercised by the
// PostgreSQL ownership drill instead of simulating a migration in memory.
import { describe, expect, it } from "vitest";
import { EXPORT_FORMAT } from "@/core/portability/ownership-export.mjs";
import { PLATFORM_VERSION } from "@/core/platform";
import { tier1Pairs as ownershipDrillPairs } from "../../scripts/ownership-drill.mjs";
import {
  MIGRATION_ARTIFACTS,
  MIGRATION_INVARIANTS,
  migrationContract,
  TIER1_TARGETS,
  tier1Pairs,
} from "@/core/portability/archive";

describe("ownership archive format (C3.18)", () => {
  it("is the logical artifact in the migration contract", () => {
    expect(MIGRATION_ARTIFACTS.logical).toBe(EXPORT_FORMAT);
    expect(MIGRATION_ARTIFACTS.database).toBe("postgres-custom-v1");
    expect(MIGRATION_ARTIFACTS.media).toBe("freeholder-media-manifest/v1");
  });
});

describe("Tier-1 pair round-trip contract (C3.19)", () => {
  it.each(tier1Pairs())("%s -> %s uses the exercised portable artifacts", (from, to) => {
    const contract = migrationContract(from, to);
    expect(contract.id).toBe(`${from}->${to}`);
    expect(contract.artifacts).toBe(MIGRATION_ARTIFACTS);
    expect(contract.invariants).toEqual([
      "ids",
      "money",
      "timestamps",
      "media",
      "locales",
      "public-urls",
    ]);
  });

  it("enumerates all 30 directed Tier-1 pairs", () => {
    expect(tier1Pairs()).toHaveLength(30);
    expect(new Set(tier1Pairs().map(([from, to]) => `${from}->${to}`)).size).toBe(30);
    expect(MIGRATION_INVARIANTS).toHaveLength(6);
    expect(TIER1_TARGETS).toHaveLength(6);
    expect(ownershipDrillPairs()).toEqual(tier1Pairs());
  });

  it("rejects a non-migration", () => {
    expect(() => migrationContract("replit", "replit")).toThrow(/different targets/);
  });
});

describe("platform version (C3.20)", () => {
  it("is semver", () => {
    expect(PLATFORM_VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });
});
