// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { selectFindMeStillDiscovery } from "@/core/findmestill/discovery";
import fixture from "../fixtures/findmestill-discovery-v0.1.json";

const document = (cards: string[]) => Buffer.from(JSON.stringify(cards));
const introduction = { contactId: fixture.contactId, now: fixture.initialTime };
const refresh = { contactId: fixture.contactId, now: fixture.movedTime, pinnedJws: fixture.initial[0]! };

describe("FindMeStill discovery v0.1", () => {
  it("accepts the standalone Python issuer's exact public fixture", () => {
    const path = new URL("../fixtures/findmestill-discovery-v0.1.json", import.meta.url);
    expect(createHash("sha256").update(readFileSync(path)).digest("hex"))
      .toBe("b95644c27b0366edbc8a27c5fd7680fb5d3f8849106583859c16b9a17cb28afd");
    expect(selectFindMeStillDiscovery([document(fixture.initial)], introduction)).toMatchObject({
      contactId: fixture.contactId,
      revision: 1,
      compactJws: fixture.initial[0],
      primaryCardUrl: fixture.primary,
      backupCardUrls: [fixture.backup],
    });
  });

  it("takes an exact signed successor after the old card has expired", () => {
    const moved = selectFindMeStillDiscovery([document(fixture.initial), document(fixture.moved)], refresh);
    expect(moved).toMatchObject({
      contactId: fixture.contactId,
      revision: 2,
      compactJws: fixture.moved[1],
      primaryCardUrl: fixture.movedPrimary,
    });
    expect(selectFindMeStillDiscovery([document(fixture.initial)], { ...refresh, pinnedJws: moved.compactJws }))
      .toEqual(moved);
  });

  it.each(["skipped", "forged", "wrongKey", "future"] as const)("rejects the standalone %s vector", (name) => {
    expect(() => selectFindMeStillDiscovery([document(fixture[name])], {
      contactId: fixture.contactId, now: fixture.movedTime,
    })).toThrow("No verified FindMeStill discovery card.");
    expect(selectFindMeStillDiscovery([document(fixture[name]), document(fixture.moved)], refresh).revision).toBe(2);
  });

  it("detects the standalone fork both across locators and against a saved pin", () => {
    expect(() => selectFindMeStillDiscovery([document(fixture.moved), document(fixture.conflict)], refresh))
      .toThrow("Conflicting FindMeStill discovery chains.");
    expect(() => selectFindMeStillDiscovery([document(fixture.conflict)], { ...refresh, pinnedJws: fixture.moved[1] }))
      .toThrow("Conflicting FindMeStill discovery chains.");
  });

  it("fails closed if the highest revision is expired", () => {
    expect(() => selectFindMeStillDiscovery([document(fixture.initial)], refresh))
      .toThrow("FindMeStill discovery head has expired.");
    expect(() => selectFindMeStillDiscovery([document(fixture.expired)], refresh))
      .toThrow("FindMeStill discovery head has expired.");
  });

  it("requires an introduction's ID and treats malformed or oversized documents as unavailable", () => {
    const copy = document(fixture.initial);
    expect(() => selectFindMeStillDiscovery([copy], { ...introduction, contactId: `fms1-${"A".repeat(43)}` }))
      .toThrow("No verified FindMeStill discovery card.");
    const oversizedChain = Array.from({ length: 65 }, () => fixture.initial[0]!);
    const malformed = [Buffer.from([0xff]), Buffer.alloc(262_145), document(oversizedChain)];
    expect(() => selectFindMeStillDiscovery(malformed, introduction)).toThrow("No verified FindMeStill discovery card.");
    expect(selectFindMeStillDiscovery([...malformed, copy], introduction).revision).toBe(1);
  });
});
