// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C5.19/C12.38: a hosting stop never invents an old read wrapper's result.
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { actorString, defineService, ServiceError } from "@/core/service";
import { lockContactIdentityForRead } from "@/core/contacts/identity-lock";
import { assertLegacyBankRecoveryGuards } from "./legacy-bank-replacement-store";
import { merchantCallerLiveness } from "./merchant-physical-caller";
import { legacyBankReads, legacyBankReadFinishes, legacyBankReadStops } from "./legacy-bank-read-schema";
import { merchantTaxDigest } from "./merchant-tax-store";
import { refunds } from "./schema";
import { queueOriginalMerchantRefundRepair } from "./merchant-refund-privacy-repair";
export const LEGACY_READER_STOP_CONFIRMATION = "ORIGINAL LEGACY READ CALLER STOP VERIFIED";
const digest = z.string().regex(/^[a-f0-9]{64}$/);
export function legacyReaderStopVerdict(input: {
  expectedCallerId: string; actualCallerId: string; expectedOriginalDigest: string; actualOriginalDigest: string;
  expectedSourceRevision: string; actualSourceRevision: string; hasFinish: boolean; liveness: "live" | "absent" | "unobservable";
}) {
  if (input.expectedCallerId !== input.actualCallerId || input.expectedOriginalDigest !== input.actualOriginalDigest
    || input.expectedSourceRevision !== input.actualSourceRevision || input.hasFinish) return "changed_or_finished" as const;
  return input.liveness === "live" ? "live" as const : input.liveness === "absent" ? "original_process_absent" as const : "unobservable_host_review" as const;
}
export const legacyBankReaderRecoveryPlan = defineService({
  name: "invoicing.legacyBankReaderRecoveryPlan", summary: "Read exact unresolved original legacy read tickets for a permitted invoice without exposing provider credentials or completion nonces.",
  kind: "query", permission: "scoped", external: false, input: z.object({ invoiceId: z.uuid() }).strict(),
  output: z.array(z.object({ refundId: z.uuid(), readId: z.uuid(), callerId: z.uuid(), originalDigest: digest, sourceRevision: digest, host: z.string(), pid: z.number().int(), startedAt: z.string(), liveness: z.enum(["live", "absent", "unobservable"]) })).max(5000),
  handler: async ({ invoiceId }, ctx) => {
    const rows = await ctx.tx.select({ read: legacyBankReads }).from(legacyBankReads).innerJoin(refunds, eq(refunds.id, legacyBankReads.refundId))
      .leftJoin(legacyBankReadFinishes, eq(legacyBankReadFinishes.readId, legacyBankReads.id)).leftJoin(legacyBankReadStops, eq(legacyBankReadStops.readId, legacyBankReads.id))
      .where(and(eq(refunds.invoiceId, invoiceId), isNull(legacyBankReadFinishes.readId), isNull(legacyBankReadStops.readId))).orderBy(asc(legacyBankReads.id)).limit(5001);
    if (rows.length > 5000) throw new ServiceError("conflict", "Restore the complete original read caller inventory before recovery review.");
    return rows.map(({ read }) => ({ refundId: read.refundId, readId: read.id, callerId: read.caller.id, originalDigest: read.originalDigest,
      sourceRevision: read.sourceRevision, host: read.caller.host, pid: read.caller.pid, startedAt: read.caller.startedAt, liveness: merchantCallerLiveness(read.caller) }));
  },
});
export const reviewLegacyBankReaderStopped = defineService({
  name: "invoicing.reviewLegacyBankReaderStopped", summary: "Review an exact original legacy read's actual hosting stop without claiming that its provider wrapper returned or money moved.",
  kind: "mutation", permission: "scoped", agentCallable: false, stepUp: true, writeClass: "money", auditInputFields: ["readId", "expectedCallerId", "expectedOriginalDigest", "expectedSourceRevision"],
  input: z.object({ readId: z.uuid(), expectedCallerId: z.uuid(), expectedOriginalDigest: digest, expectedSourceRevision: digest,
    hostingEvidence: z.string().trim().min(30).max(2000), confirmation: z.literal(LEGACY_READER_STOP_CONFIRMATION) }).strict(),
  output: z.object({ reviewed: z.literal(true), mechanicalCheck: z.enum(["original_process_absent", "unobservable_host_review"]) }),
  handler: async (input, ctx) => {
    if (ctx.actor.kind !== "user" || ctx.actor.keyScopes) throw new ServiceError("permission", "A freshly verified signed-in person must review the original read's actual hosting stop.");
    await assertLegacyBankRecoveryGuards(ctx);
    await lockContactIdentityForRead(ctx.tx);
    const [identity] = await ctx.tx.select().from(legacyBankReads).where(eq(legacyBankReads.id, input.readId));
    if (!identity) throw new ServiceError("conflict", "Restore the exact original read ticket before reviewing its hosting stop.");
    await ctx.tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`refund:${identity.refundId}`}))`);
    const [refund] = await ctx.tx.select().from(refunds).where(eq(refunds.id, identity.refundId));
    if (!refund) throw new ServiceError("conflict", "Restore the original read's actual refund owner before hosting review.");
    await ctx.tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`payment:${refund.paymentId}`}))`);
    await ctx.tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`invoice:${refund.invoiceId}`}))`);
    const [read] = await ctx.tx.select().from(legacyBankReads).where(eq(legacyBankReads.id, input.readId)).for("update");
    const [finish] = await ctx.tx.select().from(legacyBankReadFinishes).where(eq(legacyBankReadFinishes.readId, input.readId));
    if (!read || merchantTaxDigest(read.original) !== read.originalDigest) throw new ServiceError("conflict", "Restore the original read's authentic frozen resource authority.");
    const verdict = legacyReaderStopVerdict({ ...input, actualCallerId: read.caller.id, actualOriginalDigest: read.originalDigest,
      actualSourceRevision: read.sourceRevision, hasFinish: Boolean(finish), liveness: merchantCallerLiveness(read.caller) });
    if (verdict === "changed_or_finished") throw new ServiceError("conflict", "Reload this exact original read; its identity changed or its real wrapper already finished.");
    if (verdict === "live") throw new ServiceError("conflict", "The exact original process birth is still observable and live. Finish or actually stop it before recording hosting review.");
    const [prior] = await ctx.tx.select().from(legacyBankReadStops).where(eq(legacyBankReadStops.readId, read.id));
    if (!prior) {
      await ctx.tx.execute(sql`select set_config('freeholder.legacy_bank_reader_stop_v1','1',true)`);
      await ctx.tx.insert(legacyBankReadStops).values({ readId: read.id, callerInstanceId: read.caller.id, originalDigest: read.originalDigest,
        sourceRevision: read.sourceRevision, mechanicalCheck: verdict, hostingEvidenceDigest: merchantTaxDigest({ ...input, caller: read.caller, reviewedBy: actorString(ctx.actor) }), reviewedBy: actorString(ctx.actor) });
      queueOriginalMerchantRefundRepair(ctx, { kind: "legacy_bank_stop", id: read.id });
    } else if (prior.callerInstanceId !== read.caller.id || prior.originalDigest !== read.originalDigest || prior.sourceRevision !== read.sourceRevision) throw new ServiceError("conflict", "Preserve the first exact original stopped-reader review.");
    ctx.setSubject("refund", refund.id); return { reviewed: true as const, mechanicalCheck: prior?.mechanicalCheck ?? verdict };
  },
});
export default [legacyBankReaderRecoveryPlan, reviewLegacyBankReaderStopped];
