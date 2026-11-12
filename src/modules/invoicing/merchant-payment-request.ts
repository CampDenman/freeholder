// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: same-transaction original request admission, before provider I/O.
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { defineService, ServiceError, type ServiceContext } from "@/core/service";
import { lockContactIdentityForRead } from "@/core/contacts/identity-lock";
import { contacts } from "@/core/contacts/schema";
import { invoices, payments } from "./schema";
import { merchantTaxDigest } from "./merchant-tax-store";
import { merchantPaymentCreationRefusals, merchantPaymentDispatches, merchantPaymentRequests, merchantPaymentTerminalReceipts } from "./merchant-payment-recovery-schema";
import { merchantPaymentObservations } from "./merchant-collection-schema";
import type { paymentRouting } from "./merchant-charge";
import { routingForPayment } from "./merchant-charge";
import { verifyInvoiceMerchant } from "./market-policy";
import { assertNoUnappliedMerchantCharge } from "./merchant-payment-observations";
import { invoicePaymentDueAmount } from "./invoice-payment-due";

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
  input: z.object({ paymentId: z.uuid(), requestDigest: z.string().regex(/^[a-f0-9]{64}$/) }), output: z.object({ dispatchId: z.uuid(), ordinal: z.number().int().positive() }),
  handler: async (input, ctx) => {
    await lockContactIdentityForRead(ctx.tx);
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
    if (previous.length >= 100) throw new ServiceError("conflict", "This original attempt needs exact provider recovery before further creation calls.");
    const [dispatch] = await ctx.tx.insert(merchantPaymentDispatches).values({ ...input, ordinal: previous.length + 1 }).returning();
    ctx.setSubject("payment", payment.id);
    return { dispatchId: dispatch!.id, ordinal: dispatch!.ordinal };
  },
});

export async function assertMerchantPaymentTerminal(ctx: ServiceContext, paymentId: string): Promise<boolean> {
  const [request] = await ctx.tx.select().from(merchantPaymentRequests).where(eq(merchantPaymentRequests.paymentId, paymentId));
  if (!request) {
    if ((await routingForPayment(ctx, paymentId)).providerPlatformAccountId) throw new ServiceError("conflict", "Restore this new merchant payment's actual original request before claiming a terminal failure.");
    return false; // Existing legacy/platform semantics are unchanged.
  }
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
export default [claimMerchantPaymentDispatch, retainMerchantCreationRefusal];
