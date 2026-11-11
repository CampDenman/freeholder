// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C2.29/C11.10: an import key cannot discover private privacy-request bindings.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/core/db";
import { eq } from "drizzle-orm";
import { importRuns } from "@/core/plugins/schema";
import { resetStorageForTests } from "@/adapters/storage";
import { resolveContact } from "@/core/contacts/service";
import { createDataRequest, verifyDataRequest, addRetentionException, fulfillDataRequest, getDataRequest } from "@/core/privacy/service";
import { startImport, listImports } from "@/core/import/service";
import { beginSourceUpload, uploadSourceChunk } from "@/core/import/source-upload";
import { OWNER, closeDb, hasDatabase, truncateSpine } from "../helpers/spine";
describe.runIf(hasDatabase)("private source hold bindings", () => {
  beforeEach(async () => { await truncateSpine(); resetStorageForTests(); });
  afterAll(closeDb);
  it("withholds actual request/exception IDs from an exact source-only list key", async () => {
    const reader = await resolveContact.call({ email: "hold-dto-reader@example.test" }, OWNER);
    const run = await startImport.call({ origin: "https://source.example", kind: "wordpress-wxr" }, OWNER);
    const bytes = new TextEncoder().encode("<rss><channel><title>Synthetic held source</title></channel></rss>");
    const upload = await beginSourceUpload.call({ id: run.id, filename: "source.xml", bytes: bytes.byteLength }, OWNER);
    await uploadSourceChunk.call({ id: run.id, uploadId: upload.uploadId, index: 0, bytes }, OWNER);
    const request = await createDataRequest.call({ contactId: reader.contact.id, request: { kind: "erasure" } }, OWNER);
    await verifyDataRequest.call({ id: request.id, method: "Synthetic hold DTO verification" }, OWNER);
    const hold = await addRetentionException.call({ dataRequestId: request.id, scope: "cms.readerComments", reason: "legal_claim", legalBasis: "Synthetic raw-source hold" }, OWNER);
    await fulfillDataRequest.call({ id: request.id, confirmation: "ERASE" }, OWNER);
    const [saved] = await db().select().from(importRuns).where(eq(importRuns.id, run.id));
    expect(JSON.stringify(saved!.checkpoint)).toContain(hold.id);
    const actor = { kind: "agent" as const, keyName: "source-list-only", scopes: ["imports.list"] };
    await expect(getDataRequest.call({ id: request.id }, actor)).rejects.toMatchObject({ code: "permission" });
    const result = await listImports.call({ limit: 10 }, actor);
    expect(JSON.stringify(result)).not.toContain(hold.id);
    expect(JSON.stringify(result)).not.toContain(request.id);
    expect(JSON.stringify((await db().select().from(importRuns).where(eq(importRuns.id, run.id)))[0]!.checkpoint)).toContain(hold.id);
  });
});
