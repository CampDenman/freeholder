// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.12/C11.08: real service inventory, without provider I/O or copy authority.
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { users } from "@/core/auth/schema";
import { createContact } from "@/core/contacts/service";
import { addRetentionException, createDataRequest, verifyDataRequest } from "@/core/privacy/service";
import { ready } from "@/core/runtime";
import { resetEnvForTests } from "@/core/env";
import { boundStorage, resetStorageForTests } from "@/adapters/storage";
import { previewStorageTransfer } from "@/core/media/transfer-preview";
import { allowMediaReceiptWrites, objectKeyDigest } from "@/core/media/write-ledger";
import { mediaObjectWrites } from "@/core/media/write-schema";
import { storageNamespace } from "@/core/media/storage-quota";
import { closeDb, failure, hasDatabase, OWNER, CUSTOMER, truncateSpine } from "../helpers/spine";

describe.runIf(hasDatabase)("original storage-transfer preview", () => {
  const endpoint = "http://127.0.0.1:1";
  const target = { kind: "s3" as const, namespace: storageNamespace({ id: "s3", endpoint, bucket: "target" }), location: { endpoint, bucket: "target" } };
  beforeAll(ready, 60_000);
  beforeEach(async () => {
    await truncateSpine();
    await db().insert(users).values({ id: OWNER.userId, email: "transfer-owner@example.test", role: "owner" });
    // An unavailable endpoint makes any accidental object I/O fail. All
    // credentials and rows here are explicit synthetic fixtures.
    for (const [name, value] of Object.entries({ FREEHOLDER_STORAGE: "s3", S3_ENDPOINT: endpoint, S3_REGION: "fixture", S3_BUCKET: "source", S3_ACCESS_KEY_ID: "synthetic", S3_SECRET_ACCESS_KEY: "synthetic" })) vi.stubEnv(name, value);
    resetEnvForTests(); resetStorageForTests();
  });
  afterEach(() => { vi.unstubAllEnvs(); resetEnvForTests(); resetStorageForTests(); });
  afterAll(closeDb);
  async function original(key: string, state: "accepted" | "unknown" = "accepted", contactId?: string) {
    const { binding } = await boundStorage();
    return db().transaction(async tx => {
      await allowMediaReceiptWrites(tx);
      const [row] = await tx.insert(mediaObjectWrites).values({ id: randomUUID(), operation: "put", key, keyDigest: objectKeyDigest(key), namespace: binding.namespace, storageKind: binding.kind, storageLocation: binding.location, sha256: "a".repeat(64), bytes: 3, contentType: "text/plain", actor: `user:${OWNER.userId}`, contactId, state }).returning();
      return row!;
    });
  }
  it("reads complete original histories without modifying receipts or contacting either provider", async () => {
    const key = "retained/original.txt";
    const first = await original(key);
    const before = await db().select().from(mediaObjectWrites);
    const result = await previewStorageTransfer.call({ keys: [key], target }, OWNER);
    expect(result).toMatchObject({ source: { location: { bucket: "source" } }, target, permitsCopy: false, permitsAdoption: false, permitsSourceDeletion: false,
      objects: [{ key, sha256: first.sha256, bytes: 3, originalReceiptCount: 1 }] });
    expect(await db().select().from(mediaObjectWrites)).toEqual(before);
    await original(key);
    const changed = await previewStorageTransfer.call({ keys: [key], target }, OWNER);
    expect(changed.objects[0]!.originalReceiptCount).toBe(2);
    expect(changed.inventoryDigest).not.toBe(result.inventoryDigest);
    await original(key, "unknown");
    expect((await failure(previewStorageTransfer.call({ keys: [key], target }, OWNER))).code).toBe("conflict");
    expect((await db().select().from(mediaObjectWrites).where(eq(mediaObjectWrites.id, first.id)))[0]).toEqual(first);
  });
  it("refuses unprivileged or key principals, a wrong source, duplicate keys and an identical target", async () => {
    const key = "retained/permission.txt";
    await original(key);
    for (const actor of [CUSTOMER, { ...OWNER, keyScopes: ["*"] }, { kind: "system" as const }]) {
      expect((await failure(previewStorageTransfer.call({ keys: [key], target }, actor))).code).toBe("permission");
    }
    expect((await failure(previewStorageTransfer.call({ keys: [key, key], target }, OWNER))).code).toBe("validation");
    const { binding } = await boundStorage();
    expect((await failure(previewStorageTransfer.call({ keys: [key], target: binding }, OWNER))).code).toBe("validation");
    vi.stubEnv("S3_BUCKET", "wrong-source"); resetEnvForTests(); resetStorageForTests();
    expect((await failure(previewStorageTransfer.call({ keys: [key], target }, OWNER))).code).toBe("conflict");
  });
  it("rechecks the original subject's named hold without changing its physical receipt", async () => {
    const contact = await createContact.call({ name: "Original held subject", email: "held-transfer@example.test" }, OWNER);
    const key = "retained/held-original.txt";
    const row = await original(key, "accepted", contact.id);
    await previewStorageTransfer.call({ keys: [key], target }, OWNER);
    const request = await createDataRequest.call({ contactId: contact.id, request: { kind: "erasure" } }, OWNER);
    await verifyDataRequest.call({ id: request.id, method: "Synthetic held-transfer subject verification" }, OWNER);
    await addRetentionException.call({ dataRequestId: request.id, scope: "media.storageOperations", reason: "legal_obligation", legalBasis: "Synthetic named original is preserved for the verified legal obligation." }, OWNER);
    expect((await failure(previewStorageTransfer.call({ keys: [key], target }, OWNER))).code).toBe("conflict");
    expect((await db().select().from(mediaObjectWrites).where(eq(mediaObjectWrites.id, row.id)))[0]).toEqual(row);
  });
});
