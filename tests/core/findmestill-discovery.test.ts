// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { selectFindMeStillDiscovery, verifyFindMeStillDocument } from "@/core/findmestill/discovery";
import predecessorFixture from "../fixtures/findmestill-discovery-predecessor-v0.1.json";
import fixture from "../fixtures/findmestill-discovery-v0.1.json";

const document = (cards: string[]) => Buffer.from(JSON.stringify(cards));
const introduction = { contactId: fixture.contactId, now: fixture.initialTime };
const refresh = { contactId: fixture.contactId, now: fixture.movedTime, pinnedJws: fixture.initial[0]! };
const pinnedRefresh = { contactId: predecessorFixture.contactId, now: predecessorFixture.now, pinnedJws: predecessorFixture.pin };

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

  it("accepts the exact signed predecessor from an independently issued fixture", () => {
    const path = new URL("../fixtures/findmestill-discovery-predecessor-v0.1.json", import.meta.url);
    expect(createHash("sha256").update(readFileSync(path)).digest("hex"))
      .toBe("235f78cfd6b7189238e3d99622684947937ba2f7855a9ee98575c6df4f76486c");
    const current = selectFindMeStillDiscovery([document(predecessorFixture.current)], pinnedRefresh);
    expect(current).toMatchObject({ revision: 3, compactJws: predecessorFixture.pin });
    expect(selectFindMeStillDiscovery([document(predecessorFixture.predecessor)], pinnedRefresh)).toEqual(current);
  });

  it.each([
    ["conflicting", false], ["expiredConflict", true],
  ] as const)("rejects a signed %s predecessor with or without a current locator", (name, expired) => {
    const alternate = document(predecessorFixture[name]);
    const verified = verifyFindMeStillDocument(alternate, pinnedRefresh.contactId, pinnedRefresh.now).at(-1)!;
    expect(verified.revision).toBe(2);
    expect(verified.expiresAt <= pinnedRefresh.now).toBe(expired);
    const current = document(predecessorFixture.current);
    for (const candidates of [[alternate], [current, alternate], [alternate, current]]) {
      expect(() => selectFindMeStillDiscovery(candidates, pinnedRefresh)).toThrow("Conflicting FindMeStill discovery chains.");
    }
  });

  it("preserves the pin when a signed divergence ends before its known predecessor", () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const root = publicKey.export({ format: "jwk" }).x!;
    const digest = (value: string) => createHash("sha256").update(value).digest("base64url");
    const contactId = `fms1-${digest(JSON.stringify({ crv: "Ed25519", kty: "OKP", x: root }))}`;
    const profile = "findmestill-card-v0.1";
    const segment = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
    const header = segment({ alg: "Ed25519", typ: profile });
    const issue = (revision: number, previous: string | null, host: string) => {
      const payload = segment([profile, contactId, root, revision, previous, pinnedRefresh.now,
        pinnedRefresh.now + 300, `https://${host}.example/fms`, []]);
      const content = `${header}.${payload}`;
      return `${content}.${sign(null, Buffer.from(content), privateKey).toString("base64url")}`;
    };
    const genesis = issue(1, null, "original");
    const predecessor = issue(2, digest(genesis), "original");
    const pin = issue(3, digest(predecessor), "original");
    const differentGenesis = issue(1, null, "divergent");
    expect(differentGenesis).not.toBe(genesis);
    const older = document([differentGenesis]);
    const options = { contactId, pinnedJws: pin, now: pinnedRefresh.now };
    expect(verifyFindMeStillDocument(older, contactId, pinnedRefresh.now)[0]?.revision).toBe(1);
    expect(selectFindMeStillDiscovery([older], options).compactJws).toBe(pin);
    expect(() => selectFindMeStillDiscovery([older, document([genesis, predecessor, pin])], options))
      .toThrow("Conflicting FindMeStill discovery chains.");
  });

  it("treats a forged predecessor as an unavailable locator", () => {
    const [genesis, alternate] = predecessorFixture.conflicting;
    const [header, payload, signature] = alternate!.split(".");
    const forged = `${header}.${payload}.${signature![0] === "A" ? "B" : "A"}${signature!.slice(1)}`;
    expect(selectFindMeStillDiscovery([document([genesis!, forged])], pinnedRefresh).compactJws).toBe(predecessorFixture.pin);
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
