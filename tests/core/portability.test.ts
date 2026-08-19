// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Logical archive round-trip between every Tier-1 pair (C3.18, C3.19, C3.20).
import { describe, expect, it } from "vitest";
import { EXPORT_FORMAT } from "../../scripts/ownership-export.mjs";
import { PLATFORM_VERSION } from "@/core/platform";
import {
  applyLogicalArchive,
  archivePreserves,
  buildLogicalArchive,
  TIER1_TARGETS,
  tier1Pairs,
} from "@/core/portability/archive";

const FIXTURE = {
  ids: { contact: "11111111-1111-4111-8111-111111111111", invoice: "22222222-2222-4222-8222-222222222222" },
  money: [{ invoiceId: "22222222-2222-4222-8222-222222222222", amountCents: 1999, currency: "USD" }],
  timestamps: { createdAt: "2026-01-02T03:04:05.000Z" },
  media: [{ id: "asset-1", key: "original.jpg", sha256: "a".repeat(64) }],
  locales: ["en", "fr"],
  urls: ["https://example.com/about"],
};

describe("ownership archive format (C3.18)", () => {
  it("uses the same format as the one-command export", () => {
    expect(buildLogicalArchive(FIXTURE).format).toBe(EXPORT_FORMAT);
  });
});

describe("Tier-1 pair round-trip (C3.19)", () => {
  it.each(tier1Pairs())("%s → %s preserves IDs, money, timestamps, media, locales and URLs", (from, to) => {
    const archive = buildLogicalArchive(FIXTURE, { from, to });
    const restored = applyLogicalArchive(archive);
    expect(archivePreserves(FIXTURE, restored)).toEqual([]);
  });

  it("lists every Tier-1 target", () => {
    expect(TIER1_TARGETS).toContain("replit");
    expect(TIER1_TARGETS).toContain("digitalocean-droplet");
  });
});

describe("platform version (C3.20)", () => {
  it("is semver", () => {
    expect(PLATFORM_VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });
});
