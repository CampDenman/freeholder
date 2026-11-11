// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Existing import operations keep exact public verbs and original audits (C3.22).
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { resetStorageForTests } from "@/adapters/storage";
import { auditLog } from "@/core/events/schema";
import { pages } from "@/modules/cms/schema";
import { ensureDefaults } from "@/modules/cms/service";
import { type Actor } from "@/core/service";
import { commitImport, previewFromSource, startImport } from "@/core/import/service";
import { beginSourceUpload, uploadSourceChunk, previewFromUpload } from "@/core/import/source-upload";
import { OWNER, closeDb, failure, hasDatabase, truncateSpine } from "../helpers/spine";

const key = (...scopes: string[]): Actor => ({ kind: "agent", keyName: "exact-import", scopes });

describe.runIf(hasDatabase)("exact import operation scopes (C3.22)", () => {
  beforeEach(async () => { await truncateSpine(); resetStorageForTests(); await ensureDefaults.call({}, OWNER); });
  afterAll(closeDb);

  it("uploads and stages using only exact public upload verbs", async () => {
    const run = await startImport.call({ origin: "https://source.example", kind: "html" }, OWNER);
    const bytes = new TextEncoder().encode("<!DOCTYPE html><title>Exact upload</title><main><h1>Exact upload</h1><p>Fixture content</p></main>");
    const upload = await beginSourceUpload.call({ id: run.id, filename: "source.html", bytes: bytes.byteLength }, key("imports.beginSourceUpload"));
    expect(await uploadSourceChunk.call({ id: run.id, uploadId: upload.uploadId, index: 0, bytes }, key("imports.uploadSourceChunk"))).toMatchObject({ complete: true });
    expect(await previewFromUpload.call({ id: run.id, uploadId: upload.uploadId }, key("imports.previewFromUpload"))).toMatchObject({ status: "previewed", counts: { pages: 1 } });
    for (const action of ["imports.beginSourceUploadApply", "imports.recordSourceChunk", "imports.applyUploadedPreview"]) {
      const [entry] = await db().select().from(auditLog).where(eq(auditLog.action, action));
      expect(entry).toMatchObject({ actor: "agent:exact-import", subjectId: run.id });
    }
  });

  it("commits through an exact verb while retaining independent CMS permissions", async () => {
    const run = await startImport.call({ origin: "https://source.example", kind: "html" }, OWNER);
    await previewFromSource.call({ id: run.id, payload: "<title>Exact commit</title><h1>Exact commit</h1><p>Fixture body</p>" }, OWNER);
    expect((await failure(commitImport.call({ id: run.id }, key("imports.commit")))).code).toBe("permission");
    // CMS grants are a separate declared business permission, never inferred
    // from the phase binding or replaced with system authority.
    const actor = key("imports.commit", "cms.*", "seo.*");
    const result = await commitImport.call({ id: run.id }, actor);
    expect(result.status).toBe("committed");
    const [entry] = await db().select().from(auditLog).where(eq(auditLog.action, "imports.commitApply"));
    expect(entry).toMatchObject({ actor: "agent:exact-import", subjectId: run.id });
    const owned = result.checkpoint as { createdPageIds: string[] };
    expect(await db().select().from(pages).where(eq(pages.id, owned.createdPageIds[0]!))).toHaveLength(1);
    expect(actor).toMatchObject({ scopes: ["imports.commit", "cms.*", "seo.*"] });
  });
});
