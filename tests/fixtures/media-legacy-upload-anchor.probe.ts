// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Runs only against the frozen pre-upload-column producer selected by config.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { PgDialect } from "drizzle-orm/pg-core";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { users } from "@/core/auth/schema";
import { contacts } from "@/core/contacts/schema";
import { createContact } from "@/core/contacts/service";
import { beginUpload, uploadAsset } from "@/core/media/service";
import { mediaObjectWrites } from "@/core/media/write-schema";
import { ready } from "@/core/runtime";
import { stopJobs } from "@/core/jobs";
import { resetEnvForTests } from "@/core/env";
import { resetStorageForTests } from "@/adapters/storage";
import { closeDb, OWNER } from "../helpers/spine";

const output = process.env.FREEHOLDER_MEDIA_LEGACY_UPLOAD_OUTPUT!;
const root = mkdtempSync(join(tmpdir(), "freeholder-legacy-upload-producer-"));
const uploader = { ...OWNER, userId: "00000000-0000-4000-8000-000000000003", role: "customer" as const, grants: [] };
describe("frozen pre-column legacy-upload producer", () => {
  afterAll(async () => { await stopJobs(); await closeDb(); resetStorageForTests(); rmSync(root, { recursive: true, force: true }); });
  it("creates the selected genuine old reservation without fabricating provider evidence", async () => {
    process.env.FREEHOLDER_STORAGE = "local"; process.env.LOCAL_STORAGE_ROOT = root;
    resetEnvForTests(); resetStorageForTests();
    const config = { migrationsFolder: process.env.FREEHOLDER_MEDIA_LEGACY_UPLOAD_SCHEMA_ROOT! }, client = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} }), orm = drizzle(client);
    const migrations = readMigrationFiles(config);
    if (migrations[81]?.folderMillis !== 1793310000061) throw new Error("The exact current 0..81 migration prefix is required.");
    try { await new PgDialect().migrate(migrations.slice(0, 82), orm._.session as Parameters<PgDialect["migrate"]>[1], config); } finally { await client.end(); }
    await ready(); await stopJobs();
    await db().insert(users).values([{ id: OWNER.userId, email: "legacy-anchor-owner@example.test", role: "owner" }, { id: uploader.userId, email: "legacy-anchor-uploader@example.test", role: "customer" }]);
    const contact = await createContact.call({ name: "Legacy unwritten uploader", email: "legacy-anchor-uploader@example.test" }, OWNER);
    await db().update(contacts).set({ userId: uploader.userId }).where(eq(contacts.id, contact.id));
    const retired = process.env.FREEHOLDER_MEDIA_LEGACY_UPLOAD_KIND !== "unknown_unwritten";
    const body = new Uint8Array(Buffer.from("%PDF-1.7\nSynthetic genuine old upload cohort.\n%%EOF\n"));
    const upload = await beginUpload.call({ filename: retired ? "written.pdf" : "unwritten.pdf", contentType: "application/pdf", bytes: body.byteLength }, uploader);
    expect(upload.strategy).toBe("proxy");
    if (retired) await uploadAsset.call({ filename: "written.pdf", contentType: "application/pdf", bytes: body, uploadId: upload.id }, uploader);
    const writes = await db().select().from(mediaObjectWrites);
    expect(writes).toHaveLength(retired ? 1 : 0);
    if (retired) expect(writes[0]).toMatchObject({ operation: "put", state: "accepted", bytes: body.byteLength, contactId: contact.id });
    writeFileSync(output, `${JSON.stringify({ uploadId: upload.id, subjectContactId: contact.id }, null, 2)}\n`, { mode: 0o600 });
  });
});
