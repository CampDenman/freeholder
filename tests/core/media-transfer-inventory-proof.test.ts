// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.12/C11.08: enumeration never supplies missing original birth authority.
import { describe, expect, it } from "vitest";
import type { TransferInventoryConfiguration, TransferInventoryEntry } from "../../scripts/media-transfer.mjs";
import { classifySourceInventory, originalResourceAbsent, physicalInventoryBytes, providerInventoryDigest, requireCompletePages, sameProviderRevision } from "@/core/media/transfer-inventory-proof";
const namespace = "a".repeat(64), key = "private/original.bin";
const configuration: TransferInventoryConfiguration = { versioning: "Enabled", softDeleteSeconds: 0, retentionSeconds: 0 };
const revision = { kind: "etag" as const, key, namespace, value: '"original-etag"', versionId: "original-version" };
const original = { id: "original-id", key, bytes: 6, originalRevision: revision };
const current: TransferInventoryEntry = { kind: "object", key, bytes: 6, revision: { ...revision, versionId: undefined }, current: true };
const version: TransferInventoryEntry = { kind: "version", key, bytes: 6, revision, current: true };
describe("C1.12/C11.08 provider-complete original inventory", () => {
  it("joins an actual current ETag to its single exact latest version without counting bytes twice", () => {
    expect(classifySourceInventory(configuration, [current, version], [original], namespace)).toEqual({ complete: true, reason: null });
    expect(physicalInventoryBytes(configuration, [current, version])).toBe(6);
  });
  it("refuses unknown historical versions without rebinding their current key to original ownership", () => {
    const historical = { ...version, current: false, revision: { ...revision, versionId: "unattributed-history" } };
    expect(classifySourceInventory(configuration, [current, version, historical], [original], namespace)).toMatchObject({ complete: false });
    expect(physicalInventoryBytes(configuration, [current, version, historical])).toBe(12);
    expect(originalResourceAbsent([historical], key)).toBe(false);
  });
  it("refuses missing, orphan and conflicting latest-version inventory", () => {
    expect(classifySourceInventory(configuration, [current, version], [], namespace).complete).toBe(false);
    expect(classifySourceInventory(configuration, [], [original], namespace).complete).toBe(false);
    expect(() => physicalInventoryBytes(configuration, [current, version, { ...version, revision: { ...revision, versionId: "conflicting-latest" } }])).toThrow();
  });
  for (const retained of [
    { kind: "session" as const, key, bytes: 0, current: false, sessionId: "unassigned-creator" },
    { kind: "retained" as const, key, bytes: 6, current: false, revision: { ...revision, versionId: "retained-original" } },
    { kind: "delete_marker" as const, key, bytes: 0, current: true, versionId: "logical404-marker" },
  ]) it(`refuses current404 while ${retained.kind} remains and preserves unrelated generations`, () => {
    expect(originalResourceAbsent([retained], key)).toBe(false);
    expect(originalResourceAbsent([{ ...retained, key: key + ".unrelated" }], key)).toBe(true);
    expect(classifySourceInventory(configuration, [current, version, retained], [original], namespace).complete).toBe(false);
  });
  it("keeps immutable full-pass inventory digests sensitive to retained versions and provider policy", () => {
    const before = providerInventoryDigest(configuration, [current, version]);
    expect(providerInventoryDigest(configuration, [version, current])).toBe(before);
    expect(providerInventoryDigest({ ...configuration, softDeleteSeconds: 300 }, [current, version])).not.toBe(before);
    expect(providerInventoryDigest(configuration, [current, version, { ...version, current: false, revision: { ...revision, versionId: "later-history" } }])).not.toBe(before);
    expect(() => providerInventoryDigest(configuration, [current, version, version])).toThrow();
  });
  it("requires every original page and exact continuation without repeated or missing cursors", () => {
    const next = { token: "actual-original-next" };
    expect(() => requireCompletePages([{ cursor: null, next, page: { entries: [current], next } }, { cursor: next, next: null, page: { entries: [version], next: null } }])).not.toThrow();
    expect(() => requireCompletePages([{ cursor: null, next, page: { entries: [current], next } }])).toThrow();
    expect(() => requireCompletePages([{ cursor: null, next, page: { entries: [current], next } }, { cursor: null, next: null, page: { entries: [], next: null } }])).toThrow();
  });
  it("never treats equal key or ETag as an equal original namespace or retained version", () => {
    expect(sameProviderRevision(revision, { ...revision, namespace: "b".repeat(64) }, configuration)).toBe(false);
    expect(sameProviderRevision(revision, { ...revision, versionId: "unrelated-version" }, configuration)).toBe(false);
    expect(sameProviderRevision(revision, { ...revision, key: key + ".later" }, configuration)).toBe(false);
  });
  it("refuses an equal current key and bytes when the immutable original provider result is absent",()=>{
    expect(classifySourceInventory(configuration,[current,version],[{id:original.id,key,bytes:6}],namespace)).toEqual({complete:false,reason:"unproven_original_provider_revision"});
  });
  it("refuses a different generation even when its actual current ETag and full byte count equal the original",()=>{
    expect(classifySourceInventory(configuration,[current,version],[{...original,originalRevision:{...revision,versionId:"different-original-generation"}}],namespace)).toEqual({complete:false,reason:"unproven_original_provider_revision"});
  });

});
