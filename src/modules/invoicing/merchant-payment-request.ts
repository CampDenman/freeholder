// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: same-transaction original request admission, before provider I/O.
import { createHash, randomBytes } from "node:crypto";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { actorString, defineService, ServiceError, type ServiceContext } from "@/core/service";
import { lockContactIdentityForRead } from "@/core/contacts/identity-lock";
import { contacts } from "@/core/contacts/schema";
import { invoices, payments } from "./schema";
import { merchantTaxDigest } from "./merchant-tax-store";
import { merchantPaymentCreationRefusals, merchantPaymentDispatches, merchantPaymentDispatchFinishes, merchantPaymentDispatchStops, merchantPaymentRequests, merchantPaymentResourceBindings, merchantPaymentTerminalReceipts } from "./merchant-payment-recovery-schema";
import { merchantPaymentObservations } from "./merchant-collection-schema";
import type { paymentRouting } from "./merchant-charge";
import { routingForPayment } from "./merchant-charge";
import { verifyInvoiceMerchant } from "./market-policy";
import { assertNoUnappliedMerchantCharge } from "./merchant-payment-observations";
import { invoicePaymentDueAmount } from "./invoice-payment-due";
import { forgetLocalMerchantCallFinish, localMerchantCallFinish, localMerchantCallFinishes, merchantCallerLiveness, merchantPhysicalCaller, retainLocalMerchantCallFinish } from "./merchant-physical-caller";

const nonceHash = (nonce: string) => createHash("sha256").update(nonce).digest("hex");

/** A zero-money provider resource cannot prove another admitted caller finished. */
export async function assertMerchantCreatorsQuiesced(ctx: ServiceContext, paymentId: string): Promise<void> {
  const unfinished = await ctx.tx.select({ id: merchantPaymentDispatches.id }).from(merchantPaymentDispatches)
    .leftJoin(merchantPaymentDispatchFinishes, eq(merchantPaymentDispatchFinishes.dispatchId, merchantPaymentDispatches.id))
    .leftJoin(merchantPaymentDispatchStops, eq(merchantPaymentDispatchStops.dispatchId, merchantPaymentDispatches.id))
    .where(and(eq(merchantPaymentDispatches.paymentId, paymentId), isNull(merchantPaymentDispatchFinishes.dispatchId), isNull(merchantPaymentDispatchStops.dispatchId))).limit(1);
  if (unfinished.length) throw new ServiceError("conflict", "An original payment creator still needs actual completion or verified hosting stop evidence before releasing another attempt.");
}

export async function assertInvoiceMerchantCreatorsQuiesced(ctx: ServiceContext, invoiceId: string): Promise<void> {
  const unfinished = await ctx.tx.select({ id: merchantPaymentDispatches.id }).from(merchantPaymentDispatches)
    .innerJoin(payments, eq(payments.id, merchantPaymentDispatches.paymentId))
    .leftJoin(merchantPaymentDispatchFinishes, eq(merchantPaymentDispatchFinishes.dispatchId, merchantPaymentDispatches.id))
    .leftJoin(merchantPaymentDispatchStops, eq(merchantPaymentDispatchStops.dispatchId, merchantPaymentDispatches.id))
    .where(and(eq(payments.invoiceId, invoiceId), isNull(merchantPaymentDispatchFinishes.dispatchId), isNull(merchantPaymentDispatchStops.dispatchId))).limit(1);
  if (unfinished.length) throw new ServiceError("conflict", "Finish or verify the actual original payment creator before collecting another invoice portion.");
}

export const finishMerchantPaymentDispatch = defineService({
  name: "invoicing.finishMerchantPaymentDispatch", summary: "Retain actual same-caller provider promise completion independently of its money outcome.",
  kind: "mutation", permission: "system", external: false, writeClass: "money", auditInputFields: ["dispatchId"],
  input: z.object({ dispatchId: z.uuid(), completionNonce: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }), output: z.object({ finished: z.literal(true) }),
  handler: async ({ dispatchId, completionNonce }, ctx) => {
    const [dispatch] = await ctx.tx.select().from(merchantPaymentDispatches).where(eq(merchantPaymentDispatches.id, dispatchId)).for("update");
    const local = localMerchantCallFinish(dispatchId), caller = merchantPhysicalCaller();
    if (!dispatch || !local || local.paymentId !== dispatch.paymentId || local.nonce !== completionNonce || dispatch.completionNonceHash !== nonceHash(completionNonce)
      || dispatch.caller.id !== caller.id) throw new ServiceError("permission", "Only this actual completed physical caller can supply its completion receipt.");
    await ctx.tx.execute(sql`select set_config('freeholder.merchant_dispatch_v1','1',true)`);
    await ctx.tx.insert(merchantPaymentDispatchFinishes).values({ dispatchId, callerInstanceId: caller.id, outcome: local.outcome, providerRef: local.providerRef }).onConflictDoNothing();
    for (const resourceRef of new Set([local.providerRef, local.paymentRef].filter((value): value is string => value !== null))) {
      await ctx.tx.insert(merchantPaymentResourceBindings).values({ paymentId: dispatch.paymentId, dispatchId,
        resourceRef, resourceKind: resourceRef.startsWith("cs_") ? "checkout" : "intent", origin: "physical_ack",
        evidenceDigest: merchantTaxDigest({ dispatchId, callerId: caller.id, requestDigest: dispatch.requestDigest, resourceRef }) }).onConflictDoNothing();
    }
    ctx.setSubject("payment", dispatch.paymentId);
    return { finished: true as const };
  },
});

/** No service TX spans provider I/O. A lost completion commit stays cached for exact retry. */
export async function performMerchantPaymentDispatch<T>(dispatch: { dispatchId: string; completionNonce: string }, paymentId: string, work: () => Promise<T>): Promise<T> {
  let outcome: "returned" | "threw" = "threw", result: T | undefined;
  try { result = await work(); outcome = "returned"; return result; }
  finally {
    retainLocalMerchantCallFinish(dispatch.dispatchId, paymentId, dispatch.completionNonce, outcome, result);
    await finishMerchantPaymentDispatch.call({ dispatchId: dispatch.dispatchId, completionNonce: dispatch.completionNonce }, { kind: "system" });
    forgetLocalMerchantCallFinish(dispatch.dispatchId);
  }
}
export async function flushLocalMerchantPaymentDispatchFinishes(paymentId: string): Promise<void> {
  for (const [dispatchId, local] of localMerchantCallFinishes(paymentId)) {
    await finishMerchantPaymentDispatch.call({ dispatchId, completionNonce: local.nonce }, { kind: "system" });
    forgetLocalMerchantCallFinish(dispatchId);
  }
}

export const reviewMerchantPaymentCallerStopped = defineService({
  name: "invoicing.reviewMerchantPaymentCallerStopped", summary: "Review actual hosting stop evidence for one original creator, without deciding whether it charged money.",
  kind: "mutation", permission: "scoped", agentCallable: false, stepUp: true, writeClass: "money", auditInputFields: ["dispatchId", "expectedCallerId", "expectedRequestDigest"],
  input: z.object({ dispatchId: z.uuid(), expectedCallerId: z.uuid(), expectedRequestDigest: z.string().regex(/^[a-f0-9]{64}$/),
    hostingEvidence: z.string().trim().min(30).max(2000), confirmation: z.literal("ORIGINAL PAYMENT CALLER STOP VERIFIED") }).strict(), output: z.object({ reviewed: z.literal(true), mechanicalCheck: z.enum(["original_process_absent", "unobservable_host_review"]) }),
  handler: async (input, ctx) => {
    if (ctx.actor.kind !== "user" || ctx.actor.keyScopes) throw new ServiceError("permission", "A signed-in person must verify the actual original hosting stop.");
    const [dispatch] = await ctx.tx.select().from(merchantPaymentDispatches).where(eq(merchantPaymentDispatches.id, input.dispatchId)).for("update");
    if (!dispatch || dispatch.caller.id !== input.expectedCallerId || dispatch.requestDigest !== input.expectedRequestDigest) throw new ServiceError("conflict", "Reload this original physical request before reviewing its caller.");
    const liveness = merchantCallerLiveness(dispatch.caller);
    if (liveness === "live") throw new ServiceError("conflict", "The exact original process birth is still observable and live. Finish or actually stop that caller before recording its stop.");
    const mechanicalCheck = liveness === "absent" ? "original_process_absent" as const : "unobservable_host_review" as const;
    await ctx.tx.execute(sql`select set_config('freeholder.merchant_dispatch_v1','1',true)`);
    await ctx.tx.insert(merchantPaymentDispatchStops).values({ dispatchId: dispatch.id, callerInstanceId: dispatch.caller.id, requestDigest: dispatch.requestDigest,
      mechanicalCheck, hostingEvidenceDigest: merchantTaxDigest({ ...input, caller: dispatch.caller, reviewedBy: actorString(ctx.actor) }), reviewedBy: actorString(ctx.actor) }).onConflictDoNothing();
    ctx.setSubject("payment", dispatch.paymentId);
    return { reviewed: true as const, mechanicalCheck };
  },
});

/** Hosting stop and provider creation provenance are independent human reviews. */
export const reviewMerchantPaymentResourceOrigin = defineService({
  name: "invoicing.reviewMerchantPaymentResourceOrigin", summary: "Bind one actual original provider request to its resource after a lost creation acknowledgement.",
  kind: "mutation", permission: "scoped", agentCallable: false, stepUp: true, writeClass: "money", auditInputFields: ["dispatchId", "expectedRequestDigest", "resourceRef", "providerRequestReference"],
  input: z.object({ dispatchId: z.uuid(), expectedRequestDigest: z.string().regex(/^[a-f0-9]{64}$/), resourceRef: z.string().regex(/^(?:cs|pi)_[A-Za-z0-9_]+$/).max(200),
    providerRequestReference: z.string().regex(/^req_[A-Za-z0-9_]+$/).max(200), providerEvidence: z.string().trim().min(30).max(2000), confirmation: z.literal("ORIGINAL PROVIDER REQUEST VERIFIED") }).strict(),
  output: z.object({ reviewed: z.literal(true) }),
  handler: async (input, ctx) => {
    if (ctx.actor.kind !== "user" || ctx.actor.keyScopes) throw new ServiceError("permission", "A signed-in person must verify the original provider request log.");
    const [source] = await ctx.tx.select({ dispatch: merchantPaymentDispatches, payment: payments }).from(merchantPaymentDispatches)
      .innerJoin(payments, eq(payments.id, merchantPaymentDispatches.paymentId)).where(eq(merchantPaymentDispatches.id, input.dispatchId)).for("update");
    if (!source || source.dispatch.requestDigest !== input.expectedRequestDigest
      || (source.payment.method === "hosted_checkout" ? !input.resourceRef.startsWith("cs_") : source.payment.method !== "saved_method" || !input.resourceRef.startsWith("pi_"))) throw new ServiceError("conflict", "This original physical request does not match the reviewed resource type and digest.");
    await assertMerchantCreatorsQuiesced(ctx, source.payment.id);
    const routing = await routingForPayment(ctx, source.payment.id);
    await ctx.tx.execute(sql`select set_config('freeholder.merchant_dispatch_v1','1',true)`);
    await ctx.tx.insert(merchantPaymentResourceBindings).values({ paymentId: source.payment.id, dispatchId: source.dispatch.id, resourceRef: input.resourceRef,
      resourceKind: input.resourceRef.startsWith("cs_") ? "checkout" : "intent", origin: "human_request_review", reviewedBy: actorString(ctx.actor),
      evidenceDigest: merchantTaxDigest({ ...input, routing, caller: source.dispatch.caller, reviewedBy: actorString(ctx.actor) }) }).onConflictDoNothing();
    ctx.setSubject("payment", source.payment.id);
    return { reviewed: true as const };
  },
});

export async function captureMerchantPaymentRequest(ctx: ServiceContext, payment: typeof payments.$inferSelect, invoice: typeof invoices.$inferSelect, routing: z.infer<typeof paymentRouting>): Promise<void> {
  if (!routing.providerPlatformAccountId || !["hosted_checkout", "saved_method"].includes(payment.method)) return;
  await lockContactIdentityForRead(ctx.tx);
  const [existing] = await ctx.tx.select().from(merchantPaymentRequests).where(eq(merchantPaymentRequests.paymentId, payment.id));
  if (existing) return; // Never replace an original provider contact after CRM merge.
  // A lost pre80 or already-dispatched request is not reconstructed from
  // today's customer pointer. New source captures before its initial POST.
  if (payment.providerCheckoutRef || payment.providerRef || payment.status !== "created") throw new ServiceError("conflict", "Restore the original merchant provider request receipt before retrying this historical or unknown attempt.");
  const values = { paymentId: payment.id, providerInvoiceRef: invoice.id, providerContactRef: invoice.contactId,
    requestDigest: merchantTaxDigest({ paymentId: payment.id, provider: payment.provider, method: payment.method, amountMinor: payment.amountMinor, currency: payment.currency, idempotencyKey: payment.idempotencyKey, invoiceId: invoice.id, contactId: invoice.contactId, createdAt: payment.createdAt, routing }) };
  await ctx.tx.insert(merchantPaymentRequests).values(values);
}

export const claimMerchantPaymentDispatch = defineService({
  name: "invoicing.claimMerchantPaymentDispatch", summary: "Commit each physical original checkout call and fence changed request parameters before I/O.",
  kind: "mutation", permission: "system", external: false, writeClass: "money",
  input: z.object({ paymentId: z.uuid(), requestDigest: z.string().regex(/^[a-f0-9]{64}$/) }), output: z.object({ dispatchId: z.uuid(), ordinal: z.number().int().positive(), completionNonce: z.string() }),
  handler: async (input, ctx) => {
    await lockContactIdentityForRead(ctx.tx);
    const [parent] = await ctx.tx.select({ invoiceId: payments.invoiceId }).from(payments).where(eq(payments.id, input.paymentId));
    if (!parent) throw new ServiceError("not_found", "That original payment is not here.");
    // Match createPayment's invoice lock before checking any sibling creator.
    await ctx.tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`invoice:${parent.invoiceId}`}))`);
    const [payment] = await ctx.tx.select().from(payments).where(eq(payments.id, input.paymentId)).for("update");
    const [original] = await ctx.tx.select().from(merchantPaymentRequests).where(eq(merchantPaymentRequests.paymentId, input.paymentId));
    if (!payment || !original || !["created", "processing"].includes(payment.status) || Date.now() - payment.createdAt.getTime() > 23 * 60 * 60 * 1000) throw new ServiceError("conflict", "Reconcile this exact original merchant attempt; it cannot authorize a new creation call.");
    const [buyer] = await ctx.tx.select({ source: contacts.source }).from(invoices).innerJoin(contacts, eq(contacts.id, invoices.contactId)).where(eq(invoices.id, payment.invoiceId));
    if (!buyer || buyer.source === "privacy-erasure") throw new ServiceError("conflict", "The original buyer's erased identity cannot authorize new payment creation.");
    const [invoice] = await ctx.tx.select().from(invoices).where(eq(invoices.id, payment.invoiceId));
    const due = invoice ? await invoicePaymentDueAmount(invoice, ctx) : null;
    if (due === null || payment.amountMinor > due) throw new ServiceError("conflict", "This original attempt is no longer released for collection. Reconcile its existing provider resource before another call.");
    await assertNoUnappliedMerchantCharge(ctx, payment.invoiceId);
    await verifyInvoiceMerchant(payment.invoiceId, ctx);
    const previous = await ctx.tx.select().from(merchantPaymentDispatches).where(eq(merchantPaymentDispatches.paymentId, payment.id)).orderBy(asc(merchantPaymentDispatches.ordinal));
    if (previous.some(row => row.requestDigest !== input.requestDigest)) throw new ServiceError("conflict", "This payment's original provider request changed. Reconcile its actual original resource instead of replaying different parameters.");
    // Existing resources are recovered by original-account GETs. A creation
    // replay is never admitted beside an unknown or completed original call.
    if (previous.length) throw new ServiceError("conflict", "Read or reconcile the original merchant resource before another creation. A physical creation was already admitted for this attempt.");
    await assertInvoiceMerchantCreatorsQuiesced(ctx, payment.invoiceId);
    const completionNonce = randomBytes(32).toString("base64url");
    await ctx.tx.execute(sql`select set_config('freeholder.merchant_dispatch_v1','1',true)`);
    const [dispatch] = await ctx.tx.insert(merchantPaymentDispatches).values({ ...input, ordinal: previous.length + 1, caller: merchantPhysicalCaller(), completionNonceHash: nonceHash(completionNonce) }).returning();
    ctx.setSubject("payment", payment.id);
    return { dispatchId: dispatch!.id, ordinal: dispatch!.ordinal, completionNonce };
  },
});

export async function assertMerchantPaymentTerminal(ctx: ServiceContext, paymentId: string): Promise<boolean> {
  const [request] = await ctx.tx.select().from(merchantPaymentRequests).where(eq(merchantPaymentRequests.paymentId, paymentId));
  if (!request) {
    if ((await routingForPayment(ctx, paymentId)).providerPlatformAccountId) throw new ServiceError("conflict", "Restore this new merchant payment's actual original request before claiming a terminal failure.");
    return false; // Existing legacy/platform semantics are unchanged.
  }
  await assertMerchantCreatorsQuiesced(ctx, paymentId);
  const positive = await ctx.tx.select({ id: merchantPaymentObservations.id }).from(merchantPaymentObservations).where(and(eq(merchantPaymentObservations.paymentId, paymentId), eq(merchantPaymentObservations.status, "succeeded"))).limit(1);
  const [terminal] = await ctx.tx.select().from(merchantPaymentTerminalReceipts).where(eq(merchantPaymentTerminalReceipts.paymentId, paymentId));
  const dispatches = await ctx.tx.select({ id: merchantPaymentDispatches.id, refusal: merchantPaymentCreationRefusals.dispatchId }).from(merchantPaymentDispatches)
    .leftJoin(merchantPaymentCreationRefusals, eq(merchantPaymentCreationRefusals.dispatchId, merchantPaymentDispatches.id)).where(eq(merchantPaymentDispatches.paymentId, paymentId)).limit(101);
  const [payment] = await ctx.tx.select({ providerRef: payments.providerRef, checkoutRef: payments.providerCheckoutRef }).from(payments).where(eq(payments.id, paymentId));
  const notDispatched = dispatches.length === 0 && payment && !payment.providerRef && !payment.checkoutRef;
  const everyDispatchRefused = dispatches.length > 0 && dispatches.length <= 100 && dispatches.every(row => row.refusal !== null) && payment && !payment.providerRef && !payment.checkoutRef;
  if (positive.length || !terminal && !notDispatched && !everyDispatchRefused) throw new ServiceError("conflict", "This original merchant attempt still needs authenticated terminal or complete physical refusal proof. A manual failure or elapsed time cannot establish that it was not charged.");
  return true;
}

export const merchantCreationRefusalCode = z.enum(["amount_too_small", "amount_too_large", "email_invalid", "parameter_invalid_empty", "parameter_invalid_integer", "parameter_missing", "parameter_unknown", "url_invalid"]);
export const retainMerchantCreationRefusal = defineService({
  name: "invoicing.retainMerchantCreationRefusal", summary: "Retain an actual definitive physical provider refusal without clearing any other unknown dispatch.",
  kind: "mutation", permission: "system", external: false, writeClass: "money",
  input: z.object({ paymentId: z.uuid(), dispatchId: z.uuid(), providerCode: merchantCreationRefusalCode }),
  output: z.object({ mayFail: z.boolean() }),
  handler: async (input, ctx) => {
    const [payment] = await ctx.tx.select().from(payments).where(eq(payments.id, input.paymentId)).for("update");
    const [dispatch] = await ctx.tx.select().from(merchantPaymentDispatches).where(and(eq(merchantPaymentDispatches.id, input.dispatchId), eq(merchantPaymentDispatches.paymentId, input.paymentId)));
    if (!payment || !dispatch) return { mayFail: false };
    await ctx.tx.insert(merchantPaymentCreationRefusals).values({ dispatchId: dispatch.id, providerCode: input.providerCode }).onConflictDoNothing();
    ctx.setSubject("payment", payment.id);
    try { await assertMerchantPaymentTerminal(ctx, payment.id); return { mayFail: true }; }
    catch (error) { if (error instanceof ServiceError && error.code === "conflict") return { mayFail: false }; throw error; }
  },
});
export default [claimMerchantPaymentDispatch, finishMerchantPaymentDispatch, reviewMerchantPaymentCallerStopped, reviewMerchantPaymentResourceOrigin, retainMerchantCreationRefusal];
