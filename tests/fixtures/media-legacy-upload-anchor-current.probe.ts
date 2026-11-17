// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Current-runtime capture phase after the genuine old database's normal upgrade.
import { readFileSync, writeFileSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/core/db";
import { addRetentionException, createDataRequest, fulfillDataRequest, removeRetentionException, verifyDataRequest } from "@/core/privacy/service";
import { dataRequests, dataRequestArtifacts } from "@/core/privacy/schema";
import { mediaUploads } from "@/core/media/schema";
import { mediaObjectWrites } from "@/core/media/write-schema";
import { mediaOriginalErasureScopes } from "@/core/media/erasure-schema";
import { eraseMediaStorageOperations } from "@/core/media/write-privacy";
import { eraseMultipartOperations } from "@/core/media/multipart-privacy";
import { getJob, stopJobs } from "@/core/jobs";
import { ready } from "@/core/runtime";
import { closeDb, OWNER } from "../helpers/spine";

const input = z.object({ uploadId: z.uuid(), subjectContactId: z.uuid() }).strict().parse(JSON.parse(readFileSync(process.env.FREEHOLDER_MEDIA_LEGACY_UPLOAD_INPUT!, "utf8")) as unknown);
const output = process.env.FREEHOLDER_MEDIA_LEGACY_UPLOAD_OUTPUT!;
const kind = z.enum(["unknown_unwritten", "retired_written", "unrecoverable_retired_written"]).parse(process.env.FREEHOLDER_MEDIA_LEGACY_UPLOAD_KIND);
const outcomes = z.object({ outcomes: z.array(z.object({ scope: z.string(), pendingJobs: z.array(z.uuid()).optional() })) });
describe("upgraded original capture and retirement producer", () => {
  afterAll(async () => { await stopJobs(); await closeDb(); });
  it("produces the selected genuine historical cohort through actual services and workers", async () => {
    await ready(); await stopJobs();
    const [upload] = await db().select().from(mediaUploads).where(and(eq(mediaUploads.id, input.uploadId), isNull(mediaUploads.originalReservationId)));
    if (!upload) throw new Error("The genuine upgraded old NULL upload is required.");
    expect(await db().select().from(mediaObjectWrites)).toHaveLength(kind === "unknown_unwritten" ? 0 : 1);
    const source = await createDataRequest.call({ contactId: input.subjectContactId, request: { kind: "erasure" } }, OWNER);
    await verifyDataRequest.call({ id: source.id, method: "Synthetic upgraded old-uploader verification" }, OWNER);
    const hold = await addRetentionException.call({ dataRequestId: source.id, scope: "media.multipartOperations", reason: "legal_obligation", legalBasis: "Synthetic retained old cohort for the actual upgrade control." }, OWNER);
    await fulfillDataRequest.call({ id: source.id, confirmation: "ERASE" }, OWNER);
    await removeRetentionException.call({ id: hold.id }, OWNER);
    const [request] = await db().select().from(dataRequests).where(eq(dataRequests.id, source.id));
    const [scope] = await db().select().from(mediaOriginalErasureScopes).where(and(eq(mediaOriginalErasureScopes.requestId, source.id), eq(mediaOriginalErasureScopes.scope, "media.multipartOperations")));
    const [receipt] = await db().select().from(dataRequestArtifacts).where(eq(dataRequestArtifacts.dataRequestId, source.id));
    expect(request?.status).toBe("partially_completed");
    expect(scope?.complete).toBe(true);
    expect(scope?.membership.uploads).toEqual([expect.objectContaining({ id: upload.id, reservationId: null })]);
    expect(receipt).toBeDefined();
    if (kind === "retired_written") {
      const retiring = await createDataRequest.call({ contactId: input.subjectContactId, request: { kind: "erasure" } }, OWNER);
      await verifyDataRequest.call({ id: retiring.id, method: "Synthetic actual original physical retirement request" }, OWNER);
      const applied = await fulfillDataRequest.call({ id: retiring.id, confirmation: "ERASE" }, OWNER);
      const parsed = outcomes.parse(applied.artifact.body);
      for (const outcome of parsed.outcomes) for (const id of outcome.pendingJobs ?? []) {
        if (outcome.scope === "media.storageOperations") {
          const job = await getJob("core.eraseMediaStorageOperations", id);
          if (!job) throw new Error("The actual original storage-erasure job is missing.");
          await eraseMediaStorageOperations(job.data);
        } else if (outcome.scope === "media.multipartOperations") {
          const job = await getJob("core.eraseMediaMultipartOperations", id);
          if (!job) throw new Error("The actual original multipart-erasure job is missing.");
          await eraseMultipartOperations(job.data);
        }
      }
      const [terminal] = await db().select().from(dataRequests).where(eq(dataRequests.id, retiring.id));
      expect(terminal?.status).toBe("completed");
      expect((await db().select().from(mediaObjectWrites)).some(row => row.operation === "delete" && row.state === "accepted")).toBe(true);
    } else if (kind === "unknown_unwritten") expect(await db().select().from(mediaObjectWrites)).toEqual([]);
    const next = await createDataRequest.call({ contactId: input.subjectContactId, request: { kind: "erasure" } }, OWNER);
    await verifyDataRequest.call({ id: next.id, method: "Synthetic independent post-capture request verification" }, OWNER);
    writeFileSync(output, `${JSON.stringify({ kind, ...input, sourceRequestId: source.id, verifiedRequestId: next.id }, null, 2)}\n`, { mode: 0o600 });
  });
});
