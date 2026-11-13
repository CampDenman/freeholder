// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Core keeps original single-source routes through trusted same-TX source resolvers.
import { eq } from "drizzle-orm";
import { z } from "zod";
import { bookingCommercialSources, bookings } from "@/core/scheduling/schema";
import { defineService, ServiceError, type ServiceContext } from "@/core/service";
import { invoiceMerchantScopes, merchantInvoicePaymentRoutes } from "./merchant-invoice-scope-schema";
import { invoicePaymentDueAmount } from "./invoice-payment-due";
import { assertNoUnappliedMerchantCharge } from "./merchant-payment-observations";
import { merchantTaxPolicyReceipt } from "./merchant-collection";
import { getInvoiceMarketPolicy, verifyInvoiceMerchant } from "./market-policy";
import { invoiceMarketPolicies, invoices, payments } from "./schema";

const account = z.string().regex(/^acct_[A-Za-z0-9]+$/).max(200);
export const invoiceMerchantScopeReceipt = z.object({ bookingId: z.uuid(), collectionKind: z.enum(["direct", "destination"]),
  providerPlatformAccountId: account, chargeAccountId: account.nullable(), recipientAccountId: account, settlementMerchantAccountId: account,
  taxPolicy: merchantTaxPolicyReceipt.extend({ liability: z.literal("seller") }),
}).strict();
let resolve: ((ctx: ServiceContext, invoiceId: string) => Promise<z.infer<typeof invoiceMerchantScopeReceipt> | null>) | undefined;
export function registerInvoiceMerchantScopeResolver(next: NonNullable<typeof resolve>): void { resolve = next; }

export const captureInvoiceMerchantScope = defineService({
  name: "invoicing.captureMerchantScope", summary: "Freeze a new original single-source merchant invoice's actual account and tax receipt before issue.",
  kind: "mutation", permission: "system", external: false, input: z.object({ invoiceId: z.uuid() }), output: z.object({ captured: z.boolean() }),
  handler: async ({ invoiceId }, ctx) => {
    const [invoice] = await ctx.tx.select().from(invoices).where(eq(invoices.id, invoiceId));
    const [policy] = await ctx.tx.select().from(invoiceMarketPolicies).where(eq(invoiceMarketPolicies.invoiceId, invoiceId));
    if (!invoice || invoice.status !== "draft") throw new ServiceError("conflict", "Capture original merchant scope while issuing its draft invoice.");
    if (policy?.model !== "seller_merchant" || policy.collectionVersion === 1 || invoice.sourceType === "subscription") return { captured: false };
    const [existing] = await ctx.tx.select().from(invoiceMerchantScopes).where(eq(invoiceMerchantScopes.invoiceId, invoiceId));
    if (existing) return { captured: true };
    const receipt = await resolve?.(ctx, invoiceId);
    if (!receipt) {
      if (invoice.sourceType === "booking" && invoice.sourceId) {
        const [booking] = await ctx.tx.select().from(bookings).where(eq(bookings.id, invoice.sourceId));
        if (booking?.marketPolicyVersion === 1) throw new ServiceError("conflict", "This new member booking requires its original account and tax receipt; legacy direct fallback is refused.");
      }
      return { captured: false };
    }
    const original = invoiceMerchantScopeReceipt.parse(receipt);
    if (original.recipientAccountId !== policy.providerAccountId || original.settlementMerchantAccountId !== original.recipientAccountId
      || original.providerPlatformAccountId === original.recipientAccountId || (original.collectionKind === "direct" ? original.chargeAccountId !== original.recipientAccountId : original.chargeAccountId !== null)) throw new ServiceError("conflict", "The invoice scope does not match its original business identity.");
    if (invoice.sourceType === "booking" && invoice.sourceId !== original.bookingId) throw new ServiceError("conflict", "The merchant scope belongs to a different original booking.");
    await ctx.tx.insert(invoiceMerchantScopes).values({ invoiceId, ...original });
    ctx.setSubject("invoice", invoiceId);
    return { captured: true };
  },
});

export async function reserveInvoiceScopedCharge(ctx: ServiceContext, invoice: typeof invoices.$inferSelect, request: { provider: string; method: string; amountMinor: number }) {
  const [scope] = await ctx.tx.select().from(invoiceMerchantScopes).where(eq(invoiceMerchantScopes.invoiceId, invoice.id));
  if (!scope) {
    if (invoice.sourceType === "booking" && invoice.sourceId) {
      const [source] = await ctx.tx.select({ version: bookings.marketPolicyVersion, seller: bookingCommercialSources.sellerUserId }).from(bookings)
        .leftJoin(bookingCommercialSources, eq(bookingCommercialSources.bookingId, bookings.id)).where(eq(bookings.id, invoice.sourceId));
      if (source?.version === 1 && source.seller) throw new ServiceError("conflict", "Restore this new booking's original merchant scope before collecting payment.");
    }
    return null;
  }
  if (request.provider !== "stripe" || !["hosted_checkout", "saved_method"].includes(request.method)) throw new ServiceError("conflict", "Collect this original merchant invoice through its own online flow.");
  await assertNoUnappliedMerchantCharge(ctx, invoice.id);
  const due = await invoicePaymentDueAmount(invoice, ctx);
  if (due === null || request.amountMinor > due) throw new ServiceError("conflict", "This payment exceeds the original invoice's currently released amount.");
  await verifyInvoiceMerchant(invoice.id, ctx);
  const policy = await ctx.callAsSystem(getInvoiceMarketPolicy, { invoiceId: invoice.id });
  if (!policy || policy.model !== "seller_merchant") throw new ServiceError("conflict", "The original single-source merchant policy is missing.");
  const previous = await ctx.tx.select({ payment: payments, fee: merchantInvoicePaymentRoutes.applicationFeeMinor }).from(payments)
    .leftJoin(merchantInvoicePaymentRoutes, eq(merchantInvoicePaymentRoutes.paymentId, payments.id)).where(eq(payments.invoiceId, invoice.id));
  if (previous.some(row => ["created", "processing"].includes(row.payment.status))) throw new ServiceError("conflict", "Reconcile the original merchant payment before another attempt.");
  const paid = previous.filter(row => row.payment.status === "succeeded");
  if (paid.some(row => row.fee === null) || paid.reduce((sum, row) => sum + BigInt(row.payment.amountMinor), 0n) !== BigInt(invoice.paidMinor)) throw new ServiceError("conflict", "The original single-source payment history needs reconciliation.");
  const fee = BigInt(policy.feeMinor) * (BigInt(invoice.paidMinor) + BigInt(request.amountMinor)) / BigInt(invoice.totalMinor)
    - paid.reduce((sum, row) => sum + BigInt(row.fee!), 0n);
  if (fee < 0n || fee > BigInt(request.amountMinor)) throw new ServiceError("conflict", "The original commission cannot be allocated to this payment.");
  return { invoiceScopeId: invoice.id, providerPlatformAccountId: scope.providerPlatformAccountId,
    ...(scope.chargeAccountId ? { providerAccountId: scope.chargeAccountId } : {}),
    ...(scope.collectionKind === "destination" ? { destinationAccountId: scope.recipientAccountId, settlementMerchantAccountId: scope.settlementMerchantAccountId } : {}), applicationFeeMinor: Number(fee) };
}

export async function invoiceScopedRoutingForPayment(ctx: ServiceContext, paymentId: string) {
  const [original] = await ctx.tx.select({ scope: invoiceMerchantScopes, route: merchantInvoicePaymentRoutes }).from(merchantInvoicePaymentRoutes)
    .innerJoin(invoiceMerchantScopes, eq(invoiceMerchantScopes.invoiceId, merchantInvoicePaymentRoutes.invoiceId)).where(eq(merchantInvoicePaymentRoutes.paymentId, paymentId));
  if (!original) return null;
  return { invoiceScopeId: original.scope.invoiceId, providerPlatformAccountId: original.scope.providerPlatformAccountId, providerAccountId: original.scope.chargeAccountId ?? undefined,
    ...(original.scope.collectionKind === "destination" ? { destinationAccountId: original.scope.recipientAccountId, settlementMerchantAccountId: original.scope.settlementMerchantAccountId } : {}), applicationFeeMinor: original.route.applicationFeeMinor };
}

export default [captureInvoiceMerchantScope];
