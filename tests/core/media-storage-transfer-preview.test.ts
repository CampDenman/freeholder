// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.12/C11.08: real service inventory, without provider I/O or copy authority.
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { PgDialect } from "drizzle-orm/pg-core";
import { eq, sql } from "drizzle-orm";
import { db } from "@/core/db";
import { users } from "@/core/auth/schema";
import { addRetentionException, createDataRequest, verifyDataRequest } from "@/core/privacy/service";
import { ready } from "@/core/runtime";
import { resetEnvForTests } from "@/core/env";
import { boundStorage, resetStorageForTests } from "@/adapters/storage";
import { previewStorageTransfer } from "@/core/media/transfer-preview";
import { allowMediaReceiptWrites, objectKeyDigest } from "@/core/media/write-ledger";
import { mediaObjectWrites } from "@/core/media/write-schema";
import { storageNamespace } from "@/core/media/storage-quota";
import { runMigrationsOnDedicatedSession } from "@/core/migrate-runner.mjs";
import { closeDb, failure, hasDatabase, OWNER, CUSTOMER } from "../helpers/spine";

describe.runIf(hasDatabase)("original storage-transfer preview", () => {
  const endpoint = "http://127.0.0.1:1";
  const source = { id: "s3", endpoint, bucket: "source" } as const;
  const target = { kind: "s3" as const, namespace: storageNamespace({ id: "s3", endpoint, bucket: "target" }), location: { endpoint, bucket: "target" } };
  const heldContactId = randomUUID(), claimed = new Set<string>();
  type Historical = readonly [id: string, key: string, state: "accepted" | "unknown", contactId: string | null];
  const firstReceiptId = "00000000-0000-4000-8000-000000000101", repeatedReceiptId = "00000000-0000-4000-8000-000000000102", unknownReceiptId = "00000000-0000-4000-8000-000000000103";
  const initialHistory: Historical[] = [
    [firstReceiptId, "retained/original.txt", "accepted", null], ["00000000-0000-4000-8000-000000000104", "retained/permission.txt", "accepted", null],
    ["00000000-0000-4000-8000-000000000105", "retained/held-original.txt", "accepted", heldContactId],
  ];
  let receipts: Array<typeof mediaObjectWrites.$inferSelect> = [];
  async function stage(history: readonly Historical[]) {
    await closeDb();
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("The historical receipt fixture requires its declared disposable database.");
    const name = `media_preview_${randomUUID().replaceAll("-", "")}`;
    const admin = postgres(url, { max: 1, onnotice: () => {} });
    try { await admin.unsafe(`CREATE DATABASE "${name}"`); } finally { await admin.end(); }
    const scratch = new URL(url); scratch.pathname = `/${name}`;
    process.env.DATABASE_URL = scratch.toString(); resetEnvForTests();
    const client = postgres(scratch.toString(), { max: 1, onnotice: () => {} });
    try {
      const config = { migrationsFolder: "db/migrations" }, orm = drizzle(client);
      const migrations = readMigrationFiles(config);
      if (migrations[81]?.folderMillis !== 1793310000061 || !migrations[81].sql[0]?.includes("CREATE TABLE import_crawl_sources")) throw new Error("The exact pre-reservation-guard migration prefix is required.");
      await new PgDialect().migrate(migrations.slice(0, 82), orm._.session as Parameters<PgDialect["migrate"]>[1], config);
      await orm.transaction(async tx => {
        await allowMediaReceiptWrites(tx);
        await tx.execute(sql`INSERT INTO contacts (id,name,email) VALUES (${heldContactId},'Original held subject','held-transfer@example.test')`);
        for (const [id, key, state, contactId] of history) await tx.execute(sql`INSERT INTO media_object_writes (id,object_key,key_digest,storage_namespace,storage_kind,storage_location,sha256,bytes,content_type,actor,contact_id,state)
          VALUES (${id},${key},${objectKeyDigest(key)},${storageNamespace(source)},${source.id},${JSON.stringify({ endpoint, bucket: source.bucket })},${"a".repeat(64)},3,'text/plain',${`user:${OWNER.userId}`},${contactId},${state})`);
      });
      await runMigrationsOnDedicatedSession(client, config);
    } finally { await client.end(); }
    receipts = await db().select().from(mediaObjectWrites); claimed.clear();
  }
  beforeAll(ready, 60_000);
  beforeEach(async () => {
    await stage(initialHistory);
    await db().insert(users).values({ id: OWNER.userId, email: "transfer-owner@example.test", role: "owner" }).onConflictDoNothing();
    // An unavailable endpoint makes any accidental object I/O fail. All
    // credentials and rows here are explicit synthetic fixtures.
    for (const [name, value] of Object.entries({ FREEHOLDER_STORAGE: "s3", S3_ENDPOINT: endpoint, S3_REGION: "fixture", S3_BUCKET: "source", S3_ACCESS_KEY_ID: "synthetic", S3_SECRET_ACCESS_KEY: "synthetic" })) vi.stubEnv(name, value);
    resetEnvForTests(); resetStorageForTests();
  });
  afterEach(() => { vi.unstubAllEnvs(); resetEnvForTests(); resetStorageForTests(); });
  afterAll(closeDb);
  function original(key: string, state: "accepted" | "unknown" = "accepted", contactId?: string) {
    const row = receipts.find(receipt => !claimed.has(receipt.id) && receipt.key === key && receipt.state === state && receipt.contactId === (contactId ?? null));
    if (!row) throw new Error("The upgraded historical receipt cohort is incomplete.");
    claimed.add(row.id);
    return row;
  }
  it("reads complete original histories without modifying receipts or contacting either provider", async () => {
    const key = "retained/original.txt";
    const first = original(key);
    const before = await db().select().from(mediaObjectWrites);
    const result = await previewStorageTransfer.call({ keys: [key], target }, OWNER);
    expect(result).toMatchObject({ source: { location: { bucket: "source" } }, target, permitsCopy: false, permitsAdoption: false, permitsSourceDeletion: false,
      objects: [{ key, sha256: first.sha256, bytes: 3, originalReceiptCount: 1 }] });
    expect(await db().select().from(mediaObjectWrites)).toEqual(before);
    await stage([...initialHistory, [repeatedReceiptId, key, "accepted", null]]);
    const changed = await previewStorageTransfer.call({ keys: [key], target }, OWNER);
    expect(changed.objects[0]!.originalReceiptCount).toBe(2);
    expect(changed.inventoryDigest).not.toBe(result.inventoryDigest);
    await stage([...initialHistory, [repeatedReceiptId, key, "accepted", null], [unknownReceiptId, key, "unknown", null]]);
    original(key, "unknown");
    const retained = await db().select().from(mediaObjectWrites).where(eq(mediaObjectWrites.id, first.id));
    expect((await failure(previewStorageTransfer.call({ keys: [key], target }, OWNER))).code).toBe("conflict");
    expect(await db().select().from(mediaObjectWrites).where(eq(mediaObjectWrites.id, first.id))).toEqual(retained);
  });
  it("refuses unprivileged or key principals, a wrong source, duplicate keys and an identical target", async () => {
    const key = "retained/permission.txt";
    original(key);
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
    const contact = { id: heldContactId };
    const key = "retained/held-original.txt";
    const row = original(key, "accepted", contact.id);
    await previewStorageTransfer.call({ keys: [key], target }, OWNER);
    const request = await createDataRequest.call({ contactId: contact.id, request: { kind: "erasure" } }, OWNER);
    await verifyDataRequest.call({ id: request.id, method: "Synthetic held-transfer subject verification" }, OWNER);
    await addRetentionException.call({ dataRequestId: request.id, scope: "media.storageOperations", reason: "legal_obligation", legalBasis: "Synthetic named original is preserved for the verified legal obligation." }, OWNER);
    expect((await failure(previewStorageTransfer.call({ keys: [key], target }, OWNER))).code).toBe("conflict");
    expect((await db().select().from(mediaObjectWrites).where(eq(mediaObjectWrites.id, row.id)))[0]).toEqual(row);
  });
});
