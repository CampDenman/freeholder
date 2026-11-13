// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C5.19/C12.38: an actual old resource gets a new read, not a fictional create.
import { createHash, randomBytes } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { paymentAdapter } from "@/adapters/payments";
import { defineOrchestratedService, defineService, ServiceError, type Actor, type ServiceContext } from "@/core/service";
import { lockContactIdentityForRead } from "@/core/contacts/identity-lock";
import { refunds } from "./schema";
import { merchantRefundRequests } from "./merchant-refund-schema";
import { merchantPhysicalCaller } from "./merchant-physical-caller";
import { queueOriginalMerchantRefundRepair } from "./merchant-refund-privacy-repair";
import { merchantTaxDigest } from "./merchant-tax-store";
import { legacyBankCurrentRevision } from "./legacy-bank-current-state";
import { originalLegacyBankRefund } from "./legacy-refund-dispatch";
import { legacyBankOriginal, legacyBankReadFact, legacyBankReadFinishInput, legacyBankReadNonce } from "./legacy-bank-read-contract";
import { legacyBankReads, legacyBankReadFacts, legacyBankReadFinishes, legacyBankReadStops } from "./legacy-bank-read-schema";
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const system = { kind: "system" } as const;
type Fact = z.infer<typeof legacyBankReadFact>;
interface LocalRead { refundId: string; nonce: string; facts: Fact[]; outcome?: "returned" | "threw" }
const slot = Symbol.for("freeholder.legacy-bank-read-finishes.v1");
const processState = globalThis as typeof globalThis & { [slot]?: Map<string, LocalRead> };
const localReads = processState[slot] ??= new Map<string, LocalRead>();

async function schemaReady(ctx: ServiceContext) {
  const [result] = await ctx.tx.execute<{ ready: boolean }>(sql`select count(*)=12 as ready from pg_trigger where not tgisinternal
    and (tgrelid,tgname) in ((to_regclass('public.legacy_bank_reads'),'legacy_bank_reads_guard'),
      (to_regclass('public.legacy_bank_read_facts'),'legacy_bank_read_facts_guard'),
      (to_regclass('public.legacy_bank_read_finishes'),'legacy_bank_read_finishes_guard'),
      (to_regclass('public.legacy_bank_current_receipts'),'legacy_bank_current_receipts_guard'),
      (to_regclass('public.refunds'),'legacy_bank_refund_capacity_guard'),
      (to_regclass('public.refunds'),'legacy_bank_current_projection'),
      (to_regclass('public.refunds'),'legacy_bank_current_balances'),
      (to_regclass('public.legacy_bank_read_stops'),'legacy_bank_read_stops_guard'),
      (to_regclass('public.legacy_bank_read_facts'),'legacy_bank_recovered_read_guard'),
      (to_regclass('public.legacy_bank_read_finishes'),'legacy_bank_recovered_read_guard'),
      (to_regclass('public.payment_provider_events'),'legacy_bank_signed_event_lock'),
      (to_regclass('public.money_state_events'),'legacy_bank_physical_event_lock')) and tgenabled in ('O','A')`);
  if (result?.ready !== true) throw new ServiceError("conflict", "Install the complete guarded legacy bank-read schema before inspecting original money.");
}
async function allowWrites(ctx: ServiceContext) {
  await schemaReady(ctx);
  await ctx.tx.execute(sql`select set_config('freeholder.legacy_bank_read_v1','1',true)`);
}
async function readForCaller(ctx: ServiceContext, input: z.infer<typeof legacyBankReadFinishInput>) {
  const [read] = await ctx.tx.select().from(legacyBankReads).where(eq(legacyBankReads.id, input.readId)).for("update");
  if (!read || read.caller.id !== merchantPhysicalCaller().id || read.completionNonceHash !== hash(input.completionNonce)
    || merchantTaxDigest(read.original) !== read.originalDigest) throw new ServiceError("permission", "Only the exact original legacy read caller can retain its private evidence.");
  return read;
}

export const prepareLegacyBankRead = defineService({
  name: "invoicing.prepareLegacyBankRead", summary: "Freeze an authentic historical refund resource before its new read-only bank inspection.",
  kind: "mutation", permission: "system", external: false, writeClass: "money", auditInputFields: ["refundId"],
  input: z.object({ refundId: z.uuid() }).strict(), output: z.object({ readId: z.uuid(), completionNonce: legacyBankReadNonce, original: legacyBankOriginal }),
  handler: async ({ refundId }, ctx) => {
    await schemaReady(ctx); await lockContactIdentityForRead(ctx.tx);
    await ctx.tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`refund:${refundId}`}))`);
    const [refund] = await ctx.tx.select().from(refunds).where(eq(refunds.id, refundId));
    if (!refund) throw new ServiceError("not_found", "The original historical refund is unavailable.");
    await ctx.tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`payment:${refund.paymentId}`}))`);
    await ctx.tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`invoice:${refund.invoiceId}`}))`);
    const [newProtocol] = await ctx.tx.select({ id: merchantRefundRequests.id }).from(merchantRefundRequests).where(eq(merchantRefundRequests.refundId, refund.id)).limit(1);
    if (newProtocol) throw new ServiceError("conflict", "Inspect this refund through its actual original merchant protocol.");
    const original = await originalLegacyBankRefund(ctx.tx, refund);
    const [unfinished] = await ctx.tx.select({ id: legacyBankReads.id }).from(legacyBankReads)
      .leftJoin(legacyBankReadFinishes, eq(legacyBankReadFinishes.readId, legacyBankReads.id))
      .leftJoin(legacyBankReadStops, eq(legacyBankReadStops.readId, legacyBankReads.id))
      .where(and(eq(legacyBankReads.refundId, refund.id), isNull(legacyBankReadFinishes.readId), isNull(legacyBankReadStops.readId))).limit(1);
    if (unfinished) throw new ServiceError("conflict", "The original legacy inspection caller is live or unresolved; restore its actual finish before another read.");
    const completionNonce = randomBytes(32).toString("base64url"); await allowWrites(ctx);
    const [read] = await ctx.tx.insert(legacyBankReads).values({ refundId: refund.id, original, originalDigest: merchantTaxDigest(original),
      caller: merchantPhysicalCaller(), completionNonceHash: hash(completionNonce), sourceRevision: await legacyBankCurrentRevision(ctx, refund.id) }).returning();
    queueOriginalMerchantRefundRepair(ctx, { kind: "legacy_bank_read", id: read!.id });
    ctx.setSubject("refund", refund.id); return { readId: read!.id, completionNonce, original };
  },
});

export const recordLegacyBankReadFact = defineService({
  name: "invoicing.recordLegacyBankReadFact", summary: "Retain each actual original-resource read fact before another provider operation can fail.",
  kind: "mutation", permission: "system", external: false, writeClass: "money", auditInputFields: ["readId", "sequence"],
  input: legacyBankReadFinishInput.extend({ sequence: z.number().int().min(1).max(5005), fact: legacyBankReadFact }).strict(), output: z.object({ factId: z.uuid() }),
  handler: async (input, ctx) => {
    const read = await readForCaller(ctx, input), evidenceDigest = merchantTaxDigest(input.fact);
    const [existing] = await ctx.tx.select().from(legacyBankReadFacts).where(and(eq(legacyBankReadFacts.readId, read.id), eq(legacyBankReadFacts.sequence, input.sequence)));
    if (existing) {
      if (existing.evidenceDigest !== evidenceDigest || existing.kind !== input.fact.kind || merchantTaxDigest({ kind: existing.kind, value: existing.evidence }) !== evidenceDigest) throw new ServiceError("conflict", "Preserve the first exact legacy read fact; its original sequence cannot be replaced.");
      return { factId: existing.id };
    }
    const [finished] = await ctx.tx.select({ id: legacyBankReadFinishes.readId }).from(legacyBankReadFinishes).where(eq(legacyBankReadFinishes.readId, read.id));
    if (finished) throw new ServiceError("conflict", "An original returned read cannot accept later facts.");
    // Today's authenticated read namespace is distinct from unknown original
    // create metadata. A contradictory raw response is still retained intact.
    const value = input.fact.value;
    if (value.originalCreateProtocolVersion !== null || value.originalCreatePlatformAccountId !== null
      || value.readProtocolVersion !== "2026-02-25.clover" || typeof value.readProviderPlatformAccountId !== "string"
      || !/^acct_[A-Za-z0-9]+$/.test(value.readProviderPlatformAccountId) || value.chargeAccountId !== read.original.originalChargeAccountId) {
      throw new ServiceError("conflict", "Retain this read in its actual namespace without manufacturing historical platform or protocol identity.");
    }
    await allowWrites(ctx);
    const [fact] = await ctx.tx.insert(legacyBankReadFacts).values({ readId: read.id, sequence: input.sequence, kind: input.fact.kind,
      evidence: value, evidenceDigest }).returning();
    queueOriginalMerchantRefundRepair(ctx, { kind: "legacy_bank_fact", id: fact!.id });
    ctx.setSubject("refund", read.refundId); return { factId: fact!.id };
  },
});

export const finishLegacyBankRead = defineService({
  name: "invoicing.finishLegacyBankRead", summary: "Persist the actual legacy read wrapper's returned or thrown finish and complete retained fact inventory.",
  kind: "mutation", permission: "system", external: false, writeClass: "money", auditInputFields: ["readId"],
  input: legacyBankReadFinishInput, output: z.object({ finished: z.literal(true), factCount: z.number().int(), outcome: z.enum(["returned", "threw"]) }),
  handler: async (input, ctx) => {
    const read = await readForCaller(ctx, input), local = localReads.get(read.id);
    if (!local || local.refundId !== read.refundId || local.nonce !== input.completionNonce || !local.outcome) throw new ServiceError("permission", "Only the actually settled original inspection wrapper can supply its finish.");
    // Keep an observed callback in memory before attempting its transaction.
    // A failed persistence can flush these same facts without a second GET.
    for (let index = 0; index < local.facts.length; index++) await ctx.callAsSystem(recordLegacyBankReadFact, { ...input, sequence: index + 1, fact: local.facts[index]! });
    const [inventory] = await ctx.tx.execute<{ count: number; digest: string }>(sql`select count(*)::int count,
      encode(sha256(convert_to(coalesce(string_agg(evidence_digest,',' order by sequence),''),'UTF8')),'hex') digest
      from legacy_bank_read_facts where read_id=${read.id}::uuid`);
    if (!inventory || inventory.count !== local.facts.length) throw new ServiceError("conflict", "Restore the complete actual legacy read callback inventory before acknowledging its finish.");
    await allowWrites(ctx);
    await ctx.tx.insert(legacyBankReadFinishes).values({ readId: read.id, callerInstanceId: read.caller.id, outcome: local.outcome,
      factCount: inventory.count, factsDigest: inventory.digest }).onConflictDoNothing();
    const [saved] = await ctx.tx.select().from(legacyBankReadFinishes).where(eq(legacyBankReadFinishes.readId, read.id));
    if (!saved || saved.callerInstanceId !== read.caller.id || saved.outcome !== local.outcome || saved.factCount !== inventory.count || saved.factsDigest !== inventory.digest) throw new ServiceError("conflict", "Preserve the first actual legacy read finish and restore its complete facts.");
    queueOriginalMerchantRefundRepair(ctx, { kind: "legacy_bank_finish", id: read.id });
    ctx.setSubject("refund", read.refundId); return { finished: true as const, factCount: saved.factCount, outcome: saved.outcome };
  },
});

/** This flush has no provider edge. A restart cannot invent the lost holder. */
export async function flushLocalLegacyBankReadFinishes(refundId: string): Promise<void> {
  for (const [readId, local] of localReads) {
    if (local.refundId !== refundId || !local.outcome) continue;
    await finishLegacyBankRead.call({ readId, completionNonce: local.nonce }, system);
    localReads.delete(readId);
  }
}

export const inspectLegacyBankRefund = defineOrchestratedService({
  name: "invoicing.inspectLegacyBankRefund", summary: "Read an authentic old refund and retain its bank/cash inventory without adopting it into a new money protocol.",
  kind: "mutation", permission: "scoped", stepUp: true, external: false, writeClass: "money", auditInputFields: ["refundId"],
  input: z.object({ refundId: z.uuid() }).strict(),
  output: z.object({ readId: z.uuid(), factCount: z.number().int(), providerStatus: z.string().max(100).nullable(),
    originalBindingVerified: z.boolean(), cashInventoryComplete: z.boolean(), unassignedRefunds: z.number().int(), requiresReview: z.literal(true) }),
  handler: async ({ refundId }, caller: Actor) => {
    await flushLocalLegacyBankReadFinishes(refundId);
    const adapter = paymentAdapter("stripe");
    if (!adapter.inspectLegacyBankRefund || !adapter.inspectLegacyBankCash) throw new ServiceError("conflict", "The original provider cannot perform a complete legacy bank and cash inspection.");
    const actor = { kind: "system", request: caller.request } as const;
    const read = await prepareLegacyBankRead.call({ refundId }, actor);
    const local: LocalRead = { refundId, nonce: read.completionNonce, facts: [] }; localReads.set(read.readId, local);
    const remember = async (kind: Fact["kind"], value: object) => {
      const fact = legacyBankReadFact.parse(structuredClone({ kind, value }));
      local.facts.push(fact);
      if (local.facts.length > 5005) throw new ServiceError("conflict", "The actual legacy read exceeds its bounded callback inventory; preserve all earlier evidence for recovery.");
      await recordLegacyBankReadFact.call({ readId: read.readId, completionNonce: local.nonce, sequence: local.facts.length, fact }, actor);
    };
    let observed: Awaited<ReturnType<NonNullable<typeof adapter.inspectLegacyBankRefund>>> | undefined;
    let cash: Awaited<ReturnType<NonNullable<typeof adapter.inspectLegacyBankCash>>> | undefined;
    try {
      observed = await adapter.inspectLegacyBankRefund({ ...read.original,
        onRefundObserved: fact => remember("exact_refund", fact) });
      cash = await adapter.inspectLegacyBankCash({ originalPaymentRef: read.original.originalPaymentRef,
        originalChargeAccountId: read.original.originalChargeAccountId,
        onPrimaryObserved: fact => remember("primary_cash", fact), onRefundObserved: fact => remember("inventory_refund", fact),
        onInventoryObserved: fact => remember("cash_inventory", fact) });
      local.outcome = "returned";
    } finally {
      local.outcome ??= "threw";
      await finishLegacyBankRead.call({ readId: read.readId, completionNonce: local.nonce }, system);
      localReads.delete(read.readId);
    }
    // This finite slice retains actual read lifecycle and debt only. It must
    // not project money, authorize replacement or label a legacy promise paid.
    return { readId: read.readId, factCount: local.facts.length, providerStatus: observed?.rawProviderStatus ?? null,
      originalBindingVerified: observed?.originalBindingVerified === true,
      cashInventoryComplete: cash?.actual.refundsComplete === true && cash.actual.disputesComplete === true,
      unassignedRefunds: cash?.actual.refunds.filter(fact => fact.providerRef !== read.original.originalRefundRef).length ?? 0,
      requiresReview: true as const };
  },
});

export default [prepareLegacyBankRead, recordLegacyBankReadFact, finishLegacyBankRead, inspectLegacyBankRefund];
