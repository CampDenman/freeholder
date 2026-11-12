// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.31: late carrier outcomes reopen their original privacy receipt.
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/core/db";
import { z } from "zod";
import { lockContactIdentityForRead } from "@/core/contacts/identity-lock";
import { defineService } from "@/core/service";
import { completeErasureJob, reopenErasureJob } from "@/core/privacy/service";
import { admitCarrierWrites } from "./carrier-operations";
import { mailReceipts } from "./receipts";
import { mailProviderGrants } from "./schema";

type Grant = typeof mailProviderGrants.$inferSelect;
type Receipts = Awaited<ReturnType<typeof mailReceipts>>;
export function carrierRecoveryCovered(grant: Pick<Grant, "withdrawalReviews" | "carrierOperations">, receipts: Receipts): boolean {
  return grant.withdrawalReviews.at(-1)?.operationsDigest === receipts.digest("dispatch-resolution", JSON.stringify(grant.carrierOperations));
}

/** Both the reply path and the periodic worker repair a crash after the witness committed. */
export async function reopenCarrierErasures(ids?: readonly string[]): Promise<void> {
  const rows = await db().select().from(mailProviderGrants).where(and(eq(mailProviderGrants.recoveryPending, true), ids ? inArray(mailProviderGrants.id, [...ids]) : undefined)).orderBy(mailProviderGrants.updatedAt).limit(100);
  const receipts = await db().transaction(tx => mailReceipts(tx));
  for (const row of rows) {
    // This timestamp schedules bounded review fairly; it proves no provider
    // outcome. Even a damaged original artifact must not starve later rows.
    await db().transaction(async tx => { await admitCarrierWrites(tx); await tx.update(mailProviderGrants).set({ updatedAt: new Date() }).where(and(eq(mailProviderGrants.id, row.id), eq(mailProviderGrants.recoveryPending, true))); });
    if (!row.erasureRequestId) continue;
    const evidence = receipts.digest("dispatch-resolution", JSON.stringify(row.carrierOperations));
    const result = await reopenErasureJob.call({ requestId: row.erasureRequestId, scope: "mail.provider_grants", jobName: "core.withdrawProviderGrants", jobData: { grantIds: [row.id] }, idempotencyKey: `carrier:${row.id}:${evidence}` }, { kind: "system" });
    if (result.jobId) await db().transaction(async tx => {
      await admitCarrierWrites(tx);
      const [current] = await tx.select().from(mailProviderGrants).where(eq(mailProviderGrants.id, row.id)).for("update");
      if (current?.recoveryPending && receipts.digest("dispatch-resolution", JSON.stringify(current.carrierOperations)) === evidence) await tx.update(mailProviderGrants).set({ erasureJobId: result.jobId, updatedAt: new Date() }).where(eq(mailProviderGrants.id, row.id));
    });
  }
}

/** The request lock and original row locks fence a new late outcome during acknowledgment. */
export const settleCarrierErasure = defineService({
  name: "mail.settleCarrierErasure", summary: "Acknowledge original carrier erasure only while its final evidence remains covered.",
  kind: "mutation", permission: "system", external: false,
  input: z.object({ requestId: z.uuid() }), output: z.object({ settled: z.boolean() }), auditInputFields: ["requestId"],
  handler: async (input, ctx) => {
    await lockContactIdentityForRead(ctx.tx);
    await ctx.tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`privacy:${input.requestId}`}))`);
    const receipts = await admitCarrierWrites(ctx.tx);
    const cohort = await ctx.tx.select().from(mailProviderGrants).where(eq(mailProviderGrants.erasureRequestId, input.requestId)).orderBy(mailProviderGrants.id).for("update");
    if (!cohort.length || cohort.some(row => !row.redactedAt || !row.withdrawnAt || (row.recoveryPending && !carrierRecoveryCovered(row, receipts)))) return { settled: false };
    const jobs = new Set(cohort.flatMap(row => row.erasureJobId ? [row.erasureJobId] : []));
    for (const row of cohort.filter(item => item.recoveryPending)) {
      const evidence = receipts.digest("dispatch-resolution", JSON.stringify(row.carrierOperations));
      const reopened = await ctx.callAsSystem(reopenErasureJob, { requestId: input.requestId, scope: "mail.provider_grants", jobName: "core.withdrawProviderGrants", jobData: { grantIds: [row.id] }, idempotencyKey: `carrier:${row.id}:${evidence}` });
      // A missing/corrupt original artifact cannot be bypassed by an old job
      // ID or even a newer provider proof. Preserve the recovery debt.
      if (!reopened.jobId || reopened.recoveryRequired) return { settled: false };
      jobs.add(reopened.jobId);
      await ctx.tx.update(mailProviderGrants).set({ erasureJobId: reopened.jobId }).where(eq(mailProviderGrants.id, row.id));
    }
    for (const jobId of jobs) await ctx.callAsSystem(completeErasureJob, { requestId: input.requestId, scope: "mail.provider_grants", jobId });
    await ctx.tx.update(mailProviderGrants).set({ recoveryPending: false }).where(eq(mailProviderGrants.erasureRequestId, input.requestId));
    ctx.setSubject("dataRequest", input.requestId);
    return { settled: true };
  },
});
