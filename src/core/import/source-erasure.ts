// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C2.29/C11.10: original provider bytes are part of the erasure receipt.
import { z } from "zod";
import { and, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
import { defineService, ServiceError } from "@/core/service";
import { lockContactIdentity } from "@/core/contacts/identity-lock";
import { importRuns, importSourceGraphs } from "@/core/plugins/schema";
import { dataRequests, dataRequestArtifacts, privacyRetentionExceptions } from "@/core/privacy/schema";
import { boundStorage } from "@/adapters/storage";
import { deleteWithReceipt, discardUnwrittenObjectReservation } from "@/core/media/write-ledger";
import { pendingObjectIsOwned } from "@/core/media/object-ledger";
import { completeErasureJob, erasureArtifactIsIntact } from "@/core/privacy/service";

export const IMPORT_SOURCE_ERASURE_JOB = "core.eraseImportSourceObjects";
export const IMPORT_SOURCE_ERASURE_SCOPE = "imports.readerSources";
const payload = z.object({ requestId: z.uuid(), originalJobId: z.uuid(),
  keys: z.array(z.string().regex(/^imports\/[a-f0-9-]{36}\/[a-f0-9-]{36}\/\d{5}\.part$/)).min(1).max(25),
});
const receipt = z.object({ format: z.literal("freeholder.erasure-receipt"), outcomes: z.array(z.object({
  scope: z.string(), outcome: z.string(), pendingJobs: z.array(z.uuid()).optional(), completedJobs: z.array(z.uuid()).optional(),
}).passthrough()) }).passthrough();

/** C1.08/C3.47: deleting chunks does not erase their private normalized index.
 * Check and acknowledge under the same privacy/run locks as fulfilment and
 * indexing. This containment deliberately leaves immutable index cleanup open. */
export const completeOriginalSourceErasure = defineService({
  name: "imports.completeOriginalSourceErasure", summary: "Acknowledge original source deletion only when its private index does not require recovery.",
  kind: "mutation", permission: "system", external: false,
  input: payload, output: z.object({ completed: z.boolean() }), auditInputFields: ["requestId", "originalJobId"],
  handler: async (input, ctx) => {
    await lockContactIdentity(ctx.tx);
    await ctx.tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`privacy:${input.requestId}`}))`);
    const [job] = await ctx.tx.execute<{ data: unknown }>(sql`select data from pgboss.job where id=${input.originalJobId}::uuid and name=${IMPORT_SOURCE_ERASURE_JOB} and data=${JSON.stringify(input)}::jsonb limit 1`);
    if (!job) throw new ServiceError("permission", "Restore the exact original import erasure task before acknowledging it.");
    const [request] = await ctx.tx.select().from(dataRequests).where(eq(dataRequests.id, input.requestId)).for("update");
    const [artifact] = await ctx.tx.select().from(dataRequestArtifacts).where(eq(dataRequestArtifacts.dataRequestId, input.requestId)).for("update");
    const parsed = receipt.safeParse(artifact?.body);
    const outcome = parsed.success ? parsed.data.outcomes.find(item => item.scope === IMPORT_SOURCE_ERASURE_SCOPE) : undefined;
    if (!request || request.kind !== "erasure" || !request.verifiedAt || !outcome || !erasureArtifactIsIntact(artifact)) throw new ServiceError("conflict", "Restore the original verified source erasure receipt before completion.");
    ctx.setSubject("dataRequest", request.id);
    if (!outcome.pendingJobs?.includes(input.originalJobId)) {
      if (outcome.outcome === "erased" && !outcome.pendingJobs?.length
        || outcome.outcome === "retained" && outcome.completedJobs?.includes(input.originalJobId)) return { completed: true };
      throw new ServiceError("conflict", "This task is absent from its original pending source receipt.");
    }
    if (request.status !== "in_progress") throw new ServiceError("conflict", "The original source erasure is no longer in progress.");
    let recovery = false;
    // The original task supplies only run/upload membership. A current graph
    // can refuse completion; it cannot prove an old generation was erased or
    // authorize changing a later generation. Lock runs in deterministic order.
    for (const runId of [...new Set(input.keys.map(key => key.split("/")[1]!))].sort()) {
      const [run] = await ctx.tx.select().from(importRuns).where(eq(importRuns.id, runId)).for("update");
      const [graph] = await ctx.tx.select({ id: importSourceGraphs.id, planDigest: importSourceGraphs.planDigest }).from(importSourceGraphs).where(eq(importSourceGraphs.runId, runId)).for("update");
      if (!run || graph && graph.planDigest === null) recovery = true;
      const checkpoint = run?.checkpoint as Record<string, unknown> | undefined;
      const holds = z.object({ exceptionId: z.uuid(), requestId: z.uuid(), uploadId: z.uuid() }).array().safeParse(checkpoint?.sourcePrivacyHolds ?? []);
      if (!holds.success) { recovery = true; continue; }
      const uploadIds = new Set(input.keys.filter(key => key.split("/")[1] === runId).map(key => key.split("/")[2]!));
      const originalHolds = holds.data.filter(hold => uploadIds.has(hold.uploadId));
      if (originalHolds.length) {
        const [active] = await ctx.tx.select({ id: privacyRetentionExceptions.id }).from(privacyRetentionExceptions).where(and(
          or(...originalHolds.map(hold => and(eq(privacyRetentionExceptions.id, hold.exceptionId), eq(privacyRetentionExceptions.dataRequestId, hold.requestId)))),
          inArray(privacyRetentionExceptions.scope, [IMPORT_SOURCE_ERASURE_SCOPE, "cms.readerComments"]),
          or(isNull(privacyRetentionExceptions.expiresAt), gt(privacyRetentionExceptions.expiresAt, new Date())),
        )).limit(1);
        if (active) recovery = true;
      }
    }
    if (recovery) {
      await ctx.tx.update(dataRequests).set({ status: "in_progress", fulfilledAt: null,
        resolution: "Original source deletion requires recovery: verify retained ownership and erase the private normalized import index before completion." }).where(eq(dataRequests.id, request.id));
      return { completed: false };
    }
    await ctx.callAsSystem(completeErasureJob, { requestId: input.requestId, scope: IMPORT_SOURCE_ERASURE_SCOPE, jobId: input.originalJobId });
    return { completed: true };
  },
});

/** Only a durable worker calls this; provider work never holds the privacy TX. */
export async function eraseImportSourceObjects(data: Record<string, unknown>): Promise<{ erased: number }> {
  const input = payload.parse(data);
  const captured = await boundStorage();
  const { store } = captured;
  if (store.isPublic) throw new Error("Private source erasure requires the original private storage configuration.");
  // An active window or unresolved PUT can still create bytes after deletion.
  // Neither a timeout nor GET-not-found is cancellation evidence.
  for (const key of input.keys) if (await pendingObjectIsOwned(key)) throw new Error("Source storage ownership or an unresolved provider write keeps erasure pending.");
  for (const key of input.keys) {
    if (!await discardUnwrittenObjectReservation(key) && !await deleteWithReceipt(key, captured)) throw new Error("The original storage resource or unresolved physical operation keeps source erasure pending.");
  }
  const completion = await completeOriginalSourceErasure.call(input, { kind: "system" });
  if (!completion.completed) throw new Error("Original source erasure requires recovery of retained ownership or the private normalized import index.");
  return { erased: input.keys.length };
}
