// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C5.19/C12.38: exact finished legacy read proof, independent of logical money.
import { createHash } from "node:crypto";
import { asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { defineService, ServiceError, type ServiceContext } from "@/core/service";
import { lockContactIdentityForRead } from "@/core/contacts/identity-lock";
import { refunds } from "./schema";
import { legacyBankKnownRefundResources, originalLegacyBankRefund } from "./legacy-refund-dispatch";
import { legacyBankCurrentReceipts, legacyBankReadFacts, legacyBankReadFinishes, legacyBankReads } from "./legacy-bank-read-schema";
import { legacyBankReplacementCapacity } from "./legacy-bank-replacement-store";
import { merchantTaxDigest } from "./merchant-tax-store";
import { legacyBankCurrentVerdict, type LegacyBankStatus } from "./legacy-bank-current-proof";
import { queueOriginalMerchantRefundRepair } from "./merchant-refund-privacy-repair";

export async function legacyBankCurrentRevision(ctx: ServiceContext, refundId: string, excludeReadId: string | null = null) {
  const [supported] = await ctx.tx.execute<{ ready: boolean }>(sql`select to_regprocedure('public.freeholder_legacy_bank_revision(uuid,uuid)') is not null as ready`);
  if (!supported?.ready) throw new ServiceError("conflict", "Install the complete original legacy bank freshness proof before inspecting its money.");
  const [saved] = await ctx.tx.execute<{ revision: string; incomplete: boolean }>(sql`select * from freeholder_legacy_bank_revision(${refundId}::uuid,${excludeReadId}::uuid)`);
  if (!saved || saved.incomplete) throw new ServiceError("conflict", "Restore the complete original legacy resource history; a truncated inventory cannot prove current cash.");
  return z.string().regex(/^[a-f0-9]{64}$/).parse(saved.revision);
}
export async function assertLegacyBankRefundCapacity(ctx: ServiceContext, paymentId: string, key?: string, refundId?: string) {
  await ctx.tx.execute(sql`select freeholder_legacy_bank_refund_capacity(${paymentId}::uuid)`);
  if (!await legacyBankReplacementCapacity(ctx, paymentId, key, refundId)) throw new ServiceError("conflict", "The original legacy bank refund promise is live, returned or needs review. Reconcile its exact resources before another refund key.");
}

export const completeLegacyBankCurrentRead = defineService({
  name: "invoicing.completeLegacyBankCurrentRead", summary: "Prove a returned exact legacy read against authentic original money and its unchanged resource history.",
  kind: "mutation", permission: "system", external: false, writeClass: "money", auditInputFields: ["readId"],
  input: z.object({ readId: z.uuid() }).strict(), output: z.object({ receiptId: z.uuid(), status: z.enum(["pending", "requires_action", "succeeded", "failed", "canceled"]).nullable(), requiresReview: z.boolean() }),
  handler: async ({ readId }, ctx) => {
    await lockContactIdentityForRead(ctx.tx);
    const [guard] = await ctx.tx.execute<{ ready: boolean }>(sql`select exists(select 1 from pg_trigger where tgrelid=to_regclass('public.legacy_bank_current_receipts') and tgname='legacy_bank_current_receipts_guard' and tgenabled in ('O','A')) ready`);
    if (!guard?.ready) throw new ServiceError("conflict", "Restore the enabled original legacy current-proof guard before completing bank inspection.");
    const [read] = await ctx.tx.select().from(legacyBankReads).where(eq(legacyBankReads.id, readId));
    if (!read) throw new ServiceError("conflict", "Restore the exact original legacy read ticket before current-state proof.");
    await ctx.tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`refund:${read.refundId}`}))`);
    const [refund] = await ctx.tx.select().from(refunds).where(eq(refunds.id, read.refundId));
    if (!refund) throw new ServiceError("conflict", "Restore the actual original legacy refund owner before applying its bank proof.");
    await ctx.tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`payment:${refund.paymentId}`}))`);
    await ctx.tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`invoice:${refund.invoiceId}`}))`);
    const original = await originalLegacyBankRefund(ctx.tx, refund);
    const [finish] = await ctx.tx.select().from(legacyBankReadFinishes).where(eq(legacyBankReadFinishes.readId, read.id));
    const facts = await ctx.tx.select().from(legacyBankReadFacts).where(eq(legacyBankReadFacts.readId, read.id)).orderBy(asc(legacyBankReadFacts.sequence)).limit(5006);
    const digest = createHash("sha256").update(facts.map(fact => fact.evidenceDigest).join(",")).digest("hex");
    const authenticFacts = facts.every(fact => merchantTaxDigest({ kind: fact.kind, value: fact.evidence }) === fact.evidenceDigest);
    const prior = await legacyBankCurrentRevision(ctx, refund.id, read.id);
    const inventory = await legacyBankKnownRefundResources(ctx.tx, refund.paymentId, original);
    const verdict = legacyBankCurrentVerdict({ original, knownRefunds: inventory.resources, allOriginalCallersFinished: inventory.allCallersFinished, authenticOriginal: authenticFacts && merchantTaxDigest(original) === read.originalDigest
      && merchantTaxDigest(read.original) === read.originalDigest && finish?.factsDigest === digest,
      preparedRevision: read.sourceRevision, currentPriorRevision: prior, wrapperReturned: finish?.outcome === "returned",
      exactCallerFinished: finish?.callerInstanceId === read.caller.id, factCount: finish?.factCount ?? -1, facts });
    if (verdict.state !== "verified") throw new ServiceError("conflict", "The original legacy bank read is stale, unfinished, contradictory or incomplete. Preserve all facts and inspect its exact resource again.");
    const resolvedRevision = await legacyBankCurrentRevision(ctx, refund.id);
    const [priorReceipt] = await ctx.tx.select().from(legacyBankCurrentReceipts).where(eq(legacyBankCurrentReceipts.readId, read.id));
    if (priorReceipt) {
      if (priorReceipt.refundId !== refund.id || priorReceipt.resolvedRevision !== resolvedRevision || priorReceipt.status !== verdict.status
        || priorReceipt.rawStatus !== verdict.rawStatus || priorReceipt.requiresReview !== verdict.requiresReview || priorReceipt.replacementEligible !== verdict.replacementEligible) throw new ServiceError("conflict", "Preserve the original legacy current receipt; later facts cannot replace it.");
      return { receiptId: priorReceipt.id, status: verdict.status, requiresReview: verdict.requiresReview };
    }
    await ctx.tx.execute(sql`select set_config('freeholder.legacy_bank_current_v1','1',true)`);
    const [saved] = await ctx.tx.insert(legacyBankCurrentReceipts).values({ readId: read.id, refundId: refund.id, resolvedRevision,
      status: verdict.status, rawStatus: verdict.rawStatus, requiresReview: verdict.requiresReview, replacementEligible: verdict.replacementEligible }).returning();
    queueOriginalMerchantRefundRepair(ctx, { kind: "legacy_bank_current", id: saved!.id });
    ctx.setSubject("refund", refund.id); return { receiptId: saved!.id, status: verdict.status, requiresReview: verdict.requiresReview };
  },
});

/** Purely local read of retained proof. Missing or stale proof is debt; a
 * logical succeeded row cannot stand in for an actual current bank receipt. */
export async function legacyRefundBankState(ctx: ServiceContext, refundId: string) {
  const [read] = await ctx.tx.select({ id: legacyBankReads.id }).from(legacyBankReads).where(eq(legacyBankReads.refundId, refundId)).limit(1);
  const empty = { hasRead: Boolean(read), verified: false, receiptId: null as string | null, status: null as LegacyBankStatus, requiresReview: Boolean(read), replacementEligible: false };
  if (!read) return empty;
  const [current] = await ctx.tx.execute<{ receipt_id: string; status: LegacyBankStatus; requires_review: boolean }>(sql`select * from freeholder_legacy_bank_current(${refundId}::uuid)`);
  if (!current) return empty;
  const [receipt] = await ctx.tx.select().from(legacyBankCurrentReceipts).where(eq(legacyBankCurrentReceipts.id, current.receipt_id));
  const [ticket] = receipt ? await ctx.tx.select().from(legacyBankReads).where(eq(legacyBankReads.id, receipt.readId)) : [];
  const [refund] = await ctx.tx.select().from(refunds).where(eq(refunds.id, refundId));
  if (!ticket || !refund || ticket.refundId !== refund.id) return empty;
  try {
    const original = await originalLegacyBankRefund(ctx.tx, refund);
    if (merchantTaxDigest(original) !== ticket.originalDigest || merchantTaxDigest(ticket.original) !== ticket.originalDigest) return empty;
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof ServiceError && ["conflict", "not_found"].includes(error.code)) return empty;
    throw error;
  }
  return { hasRead: true, verified: true, receiptId: current.receipt_id, status: current.status, requiresReview: current.requires_review, replacementEligible: receipt?.replacementEligible === true };
}
