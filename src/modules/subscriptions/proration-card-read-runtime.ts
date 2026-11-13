// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C9.33/C12.38: short original-read transactions; provider I/O stays outside.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { defineService, getService, ServiceError, type Actor, type ServiceContext } from "@/core/service";
import { lockContactIdentityForRead } from "@/core/contacts/identity-lock";
import { merchantPaymentEvidence, recordMerchantPaymentObservation } from "@/modules/invoicing/merchant-payment-observations";
import type { z as Zod } from "zod";
import { merchantPhysicalCaller } from "@/modules/invoicing/merchant-physical-caller";
import { invoices, payments } from "@/modules/invoicing/schema";
import { merchantPaymentRequests } from "@/modules/invoicing/merchant-payment-recovery-schema";
import { assertMerchantCreatorsQuiesced, flushLocalMerchantPaymentDispatchFinishes } from "@/modules/invoicing/merchant-payment-request";
import { merchantTaxDigest } from "@/modules/invoicing/merchant-tax-store";
import { subscriptionProrations } from "./proration-schema";
import { PRORATION_CARD_READ_PURPOSE } from "./proration-card-contract";
import { subscriptionProrationCardReads, subscriptionProrationCardReadFinishes, subscriptionProrationCardReadStops } from "./proration-card-schema";
import { assertProrationCardReadsQuiesced, finishedProrationCardRead, originalProrationCardRead } from "./proration-card-read-proof";
import { originalProrationPaymentProtocol } from "./proration-payment-protocol";
import { requireProrationCardSchema } from "./proration-card-mandate";
import { signProviderReadProof } from "./provider-read-signatures";
const nonceHash = (nonce: string) => createHash("sha256").update(nonce).digest("hex");
type HeldRead = { paymentId: string; invoiceId: string; prorationId: string; nonce: string; completed: boolean; actualResult?: Record<string, unknown> };
const slot = Symbol.for("freeholder.subscription-proration.payment-read.actual.v1");
const globals = globalThis as typeof globalThis & { [slot]?: Map<string, HeldRead> };
const held = globals[slot] ??= new Map<string, HeldRead>();
type ReadObservation = { paymentId: string; providerEventRef: string; evidence: Zod.infer<typeof merchantPaymentEvidence> };
type ReadRetirement = { paymentId: string; checkoutRef?: string; paymentRef?: string; kind: "session_expired" | "intent_canceled" };
export interface ProrationRecoveryObserver { observe(): Promise<void>; retainObservation(input: ReadObservation): Promise<void>; retainRetirement(input: ReadRetirement): Promise<void>; returned(value: unknown): Promise<void> }

export async function originalProrationPaymentReadSource(ctx: ServiceContext, paymentId: string) {
  const [source] = await ctx.tx.select({ payment: payments, invoice: invoices }).from(payments).innerJoin(invoices, eq(invoices.id, payments.invoiceId)).where(eq(payments.id, paymentId)).limit(1);
  if (!source || source.invoice.sourceType !== "subscription" || source.invoice.sourceId?.split(":")[1] !== "proration") return null;
  const [accepted] = await ctx.tx.select().from(subscriptionProrations).where(eq(subscriptionProrations.debitInvoiceId, source.invoice.id)).limit(1);
  const [request] = await ctx.tx.select().from(merchantPaymentRequests).where(eq(merchantPaymentRequests.paymentId, paymentId)).limit(1);
  if (!accepted || source.invoice.sourceId !== `${accepted.subscriptionId}:proration:${accepted.id}` || !request || request.providerInvoiceRef !== source.invoice.id
    || source.payment.provider !== "stripe" || !["saved_method", "hosted_checkout"].includes(source.payment.method))
    throw new ServiceError("conflict", "Restore the exact original proration payment and immutable merchant request before bank recovery.");
  const protocol = await originalProrationPaymentProtocol(ctx, paymentId);
  const immutablePayment = { id: source.payment.id, invoiceId: source.payment.invoiceId, provider: source.payment.provider, method: source.payment.method,
    currency: source.payment.currency, amountMinor: source.payment.amountMinor, idempotencyKey: source.payment.idempotencyKey, requestHash: source.payment.requestHash, createdAt: source.payment.createdAt };
  return { ...source, accepted, request, sourceRevision: merchantTaxDigest({ prorationId: accepted.id, invoiceId: source.invoice.id,
    snapshot: accepted.snapshot, acceptedQuoteDigest: accepted.acceptedQuoteDigest, immutablePayment, originalRequest: request, protocol }) };
}
export async function lockProrationPaymentReadOwner(ctx: ServiceContext, paymentId: string) {
  await lockContactIdentityForRead(ctx.tx);
  await ctx.tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`payment:${paymentId}`}))`);
  const source = await originalProrationPaymentReadSource(ctx, paymentId);
  if (source) await ctx.tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`invoice:${source.invoice.id}`}))`);
  return source;
}
export const claimProrationPaymentRead = defineService({ name: "subscriptions.claimProrationPaymentRead", summary: "Admit one exact actual recovery GET/cancel caller independently from its original payment POST.",
  kind: "mutation", permission: "system", external: false, writeClass: "money", input: z.object({ paymentId: z.uuid(), action: z.enum(["inspect", "retire"]) }),
  output: z.object({ readId: z.uuid(), nonce: z.string(), invoiceId: z.uuid(), prorationId: z.uuid() }).nullable(),
  handler: async (input, ctx) => {
    const source = await lockProrationPaymentReadOwner(ctx, input.paymentId); if (!source) return null;
    await requireProrationCardSchema(ctx); await assertMerchantCreatorsQuiesced(ctx, input.paymentId); await assertProrationCardReadsQuiesced(ctx.tx, [input.paymentId]);
    const original = getService("invoicing.merchantPaymentRecoverySource");
    if (!original) throw new ServiceError("conflict", "Restore the shared original merchant recovery source before admitting a new bank caller.");
    // This service returns real original resource bindings and namespace; no
    // current account, amount coincidence or today's customer can replace it.
    const actual = z.record(z.string(), z.unknown()).parse(JSON.parse(JSON.stringify(await ctx.callAsSystem(original, { paymentId: input.paymentId }))));
    const readId = randomUUID(), nonce = randomBytes(32).toString("base64url"), caller = merchantPhysicalCaller();
    const admission = signProviderReadProof("admission", { purpose: PRORATION_CARD_READ_PURPOSE, readId, paymentId: input.paymentId, prorationId: source.accepted.id,
      callerId: caller.id, caller, requestDigest: merchantTaxDigest({ action: input.action, sourceRevision: source.sourceRevision, actual }),
      sourceRevision: source.sourceRevision, completionDigest: nonceHash(nonce), request: { action: input.action, source: actual } });
    if (Buffer.byteLength(JSON.stringify(admission)) > 128000) throw new ServiceError("conflict", "The exact original bank-read admission exceeds its bounded evidence budget.");
    await ctx.tx.execute(sql`select set_config('freeholder.proration_card_v1','1',true)`);
    await ctx.tx.insert(subscriptionProrationCardReads).values({ id: readId, paymentId: input.paymentId, admission, admissionDigest: merchantTaxDigest(admission) });
    return { readId, nonce, invoiceId: source.invoice.id, prorationId: source.accepted.id };
  },
});
const holderInput = z.object({ readId: z.uuid(), nonce: z.string().min(20).max(200) });
async function actualHolder(ctx: ServiceContext, readId: string, nonce: string) {
  const local = held.get(readId);
  if (!local) throw new ServiceError("permission", "Only the actual original process holds this reader's callback nonce.");
  const source = await lockProrationPaymentReadOwner(ctx, local.paymentId);
  const [ticket] = await ctx.tx.select().from(subscriptionProrationCardReads).where(eq(subscriptionProrationCardReads.id, readId)).limit(1);
  const proof = ticket ? originalProrationCardRead(ticket) : null;
  const [stopped] = await ctx.tx.select().from(subscriptionProrationCardReadStops).where(eq(subscriptionProrationCardReadStops.readId, readId)).limit(1);
  if (!local || !ticket || !proof || local.paymentId !== ticket.paymentId || local.nonce !== nonce || nonceHash(nonce) !== proof.payload.completionDigest
    || proof.payload.callerId !== merchantPhysicalCaller().id || stopped) throw new ServiceError("permission", "Only this actual original unstopped reader can submit its callback or completion; late stopped callbacks are refused.");
  if (!source || source.sourceRevision !== proof.payload.sourceRevision) throw new ServiceError("conflict", "The actual original payment request changed. Preserve its old facts and recover its immutable source before another observation.");
  return { local, ticket, proof, source };
}
export const admitProrationPaymentReadCallback = defineService({ name: "subscriptions.admitProrationPaymentReadCallback", summary: "Refuse a stopped, substituted or unowned original bank reader before its callback can enter shared money services.",
  kind: "query", permission: "system", external: false, input: holderInput, output: z.object({ admitted: z.literal(true) }),
  handler: async (input, ctx) => { await actualHolder(ctx, input.readId, input.nonce); return { admitted: true as const }; } });
export const retainProrationPaymentReadObservation = defineService({ name: "subscriptions.retainProrationPaymentReadObservation", summary: "Retain actual original reader facts under the same owner lock as its stop fence.",
  kind: "mutation", permission: "system", external: false, writeClass: "money",
  input: holderInput.extend({ observation: z.object({ paymentId: z.uuid(), providerEventRef: z.string().min(1).max(500), evidence: merchantPaymentEvidence }) }), output: z.object({ retained: z.literal(true) }),
  handler: async (input, ctx) => {
    const { ticket } = await actualHolder(ctx, input.readId, input.nonce);
    if (ticket.paymentId !== input.observation.paymentId) throw new ServiceError("permission", "The actual original read cannot submit another payment's bank observation.");
    await ctx.callAsSystem(recordMerchantPaymentObservation, input.observation);
    return { retained: true as const };
  },
});
export const retainProrationPaymentReadRetirement = defineService({ name: "subscriptions.retainProrationPaymentReadRetirement", summary: "Retain the original actual cancellation acknowledgement under the same owner lock as its runtime-stop fence.",
  kind: "mutation", permission: "system", external: false, writeClass: "money",
  input: holderInput.extend({ retirement: z.object({ paymentId: z.uuid(), checkoutRef: z.string().regex(/^cs_[A-Za-z0-9_]+$/).max(200).optional(), paymentRef: z.string().regex(/^pi_[A-Za-z0-9_]+$/).max(200).optional(), kind: z.enum(["session_expired", "intent_canceled"]) }) }),
  output: z.object({ retained: z.literal(true) }),
  handler: async (input, ctx) => {
    const { ticket } = await actualHolder(ctx, input.readId, input.nonce);
    if (ticket.paymentId !== input.retirement.paymentId) throw new ServiceError("permission", "The actual original reader cannot retire another payment's resource.");
    const retain = getService("invoicing.retainMerchantRetirementAck");
    if (!retain) throw new ServiceError("conflict", "Restore the original shared physical retirement receipt writer.");
    await ctx.callAsSystem(retain, input.retirement);
    return { retained: true as const };
  },
});
export const finishProrationPaymentRead = defineService({ name: "subscriptions.finishProrationPaymentRead", summary: "Retain only the actual original process's returned/thrown bank caller, never an invented finish or another reader's result.",
  kind: "mutation", permission: "system", external: false, writeClass: "money", input: holderInput, output: z.object({ finished: z.literal(true) }),
  handler: async (input, ctx) => {
    const { local, ticket, proof } = await actualHolder(ctx, input.readId, input.nonce);
    if (!local.completed || !local.actualResult) throw new ServiceError("permission", "The actual physical bank call has not completed in its original process.");
    const signed = signProviderReadProof("finish", { purpose: PRORATION_CARD_READ_PURPOSE, readId: ticket.id, paymentId: ticket.paymentId, prorationId: proof.payload.prorationId,
      requestDigest: proof.payload.requestDigest, callerId: proof.payload.callerId, completionDigest: proof.payload.completionDigest, admissionDigest: ticket.admissionDigest,
      outcome: local.actualResult.outcome, factsDigest: merchantTaxDigest(local.actualResult) });
    if (signed.publicKey !== proof.publicKey) throw new ServiceError("permission", "A replacement process cannot sign the original reader's finish.");
    await ctx.tx.execute(sql`select set_config('freeholder.proration_card_v1','1',true)`);
    await ctx.tx.insert(subscriptionProrationCardReadFinishes).values({ readId: ticket.id, proof: signed, proofDigest: merchantTaxDigest(signed), actualResult: local.actualResult }).onConflictDoNothing();
    const [saved] = await ctx.tx.select().from(subscriptionProrationCardReadFinishes).where(eq(subscriptionProrationCardReadFinishes.readId, ticket.id)).limit(1);
    if (!saved || !finishedProrationCardRead(ticket, saved)) throw new ServiceError("conflict", "Preserve the exact first actual original bank finish.");
    return { finished: true as const };
  },
});
export async function flushProrationPaymentReadFinishes(paymentId: string) {
  for (const [readId, local] of held) if (local.paymentId === paymentId && local.completed) {
    await finishProrationPaymentRead.call({ readId, nonce: local.nonce }, { kind: "system" }); held.delete(readId);
  }
}

/** Existing non-proration recovery keeps its original path. Every new gross
 * target's saved/hosted recovery has an independent actual caller admission.
 * returned() is invoked only after its SDK I/O really returns, before logical
 * terminal application. Finally still preserves throws and lost finish commits. */
export async function withProrationPaymentRecovery<T>(input: { paymentId: string; action: "inspect" | "retire" }, caller: Actor, work: (observer: ProrationRecoveryObserver) => Promise<T>): Promise<T> {
  await flushProrationPaymentReadFinishes(input.paymentId);
  await flushLocalMerchantPaymentDispatchFinishes(input.paymentId);
  const system = { kind: "system", request: caller.request } as const;
  const claim = await claimProrationPaymentRead.call(input, system);
  if (!claim) return work({ observe: async () => {}, retainObservation: async observation => { await recordMerchantPaymentObservation.call(observation, system); }, retainRetirement: async retirement => {
    const retain = getService("invoicing.retainMerchantRetirementAck");
    if (!retain) throw new ServiceError("conflict", "Restore the shared original retirement receipt writer.");
    await retain.call(retirement, system);
  }, returned: async () => {} });
  const local: HeldRead = { paymentId: input.paymentId, invoiceId: claim.invoiceId, prorationId: claim.prorationId, nonce: claim.nonce, completed: false };
  held.set(claim.readId, local);
  const finish = async () => { await finishProrationPaymentRead.call({ readId: claim.readId, nonce: claim.nonce }, system); };
  const observer: ProrationRecoveryObserver = {
    observe: async () => { await admitProrationPaymentReadCallback.call({ readId: claim.readId, nonce: claim.nonce }, system); },
    retainObservation: async observation => { await retainProrationPaymentReadObservation.call({ readId: claim.readId, nonce: claim.nonce, observation }, system); },
    retainRetirement: async retirement => { await retainProrationPaymentReadRetirement.call({ readId: claim.readId, nonce: claim.nonce, retirement }, system); },
    returned: async value => {
      local.completed = true; local.actualResult = { outcome: "returned", actualBankResultDigest: merchantTaxDigest(value) };
      await finish();
    },
  };
  try { return await work(observer); }
  finally {
    if (!local.completed) { local.completed = true; local.actualResult = { outcome: "threw" }; }
    await finish(); held.delete(claim.readId);
    const complete = getService("subscriptions.completePaidProration");
    if (!complete) throw new ServiceError("conflict", "The original bank result is retained; restore shared paid-proration completion before changing access.");
    await complete.call({ invoiceId: claim.invoiceId }, { kind: "system", request: caller.request });
  }
}
export default [claimProrationPaymentRead, admitProrationPaymentReadCallback, retainProrationPaymentReadObservation, retainProrationPaymentReadRetirement, finishProrationPaymentRead];
