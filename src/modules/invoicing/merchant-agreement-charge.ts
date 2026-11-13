// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.26/C12.38: original agreement routes compose through the money services.
import { eq } from "drizzle-orm";
import { z } from "zod";
import { paymentAdapter, type MerchantChargeScope } from "@/adapters/payments";
import { ServiceError, type ServiceContext } from "@/core/service";
import { reserveOriginalSubscriptionCashApplication } from "./merchant-refund-application";
import { assertNoUnappliedMerchantCharge } from "./merchant-payment-observations";
import { invoicePaymentDueAmount } from "./invoice-payment-due";
import { merchantAgreementPaymentRoutes } from "./merchant-agreement-schema";
import { getInvoiceMarketPolicy, verifyInvoiceMerchant } from "./market-policy";
import { type invoices } from "./schema";
import { commercialInvoiceCashHistory } from "./commercial-attestations";
import { invoiceCashFeeAllocation } from "./invoice-credit-cash-fee";

export type SubscriptionInvoiceRouting = {
  subscriptionId: string; agreementRoutingVersion: 1; scope: MerchantChargeScope; siteFeeBps: number;
  providerOrigin?: { providerApiVersion?: "2026-10-28.endive"; receiptId: string; providerSubscriptionRef: string; providerInvoiceRef: string; providerPaymentIntentRef: string; providerChargeRef: string };
};
let resolver: ((ctx: ServiceContext, input: { invoiceId: string; method: string; subscriptionChargeReceiptId?: string }) => Promise<SubscriptionInvoiceRouting | null>) | undefined;
/** Startup-only; source reads immutable agreement/receipt facts in this TX. */
export function registerSubscriptionInvoiceRouting(next: NonNullable<typeof resolver>): void { resolver = next; }
const account = z.string().regex(/^acct_[A-Za-z0-9]+$/).max(200);
const scopeSchema = z.object({ providerApiVersion: z.enum(["2026-02-25.clover", "2026-10-28.endive"]).optional(), providerPlatformAccountId: account, providerAccountId: account.optional(), destinationAccountId: account.optional(), settlementMerchantAccountId: account.optional() });
export type ReservedAgreementCharge = z.infer<typeof scopeSchema> & {
  providerAccountId: string; applicationFeeMinor: number; agreementSubscriptionId: string;
  providerSubscriptionRef?: string; providerInvoiceRef?: string; providerPaymentIntentRef?: string; providerChargeRef?: string; originalChargeReceiptId?: string;
};

export async function reserveAgreementCharge(ctx: ServiceContext, invoice: typeof invoices.$inferSelect, request: { provider: string; method: string; amountMinor: number; subscriptionChargeReceiptId?: string }): Promise<ReservedAgreementCharge | null> {
  const original = await resolver?.(ctx, { invoiceId: invoice.id, method: request.method, subscriptionChargeReceiptId: request.subscriptionChargeReceiptId });
  if (!original) return null;
  if (invoice.sourceType !== "subscription" || invoice.sourceId?.split(":")[0] !== original.subscriptionId || original.agreementRoutingVersion !== 1
    || request.provider !== "stripe" || !["hosted_checkout", "saved_method", "provider_schedule"].includes(request.method)) throw new ServiceError("conflict", "This payment does not match its original new merchant agreement.");
  if (original.providerOrigin?.receiptId) await reserveOriginalSubscriptionCashApplication(ctx, original.providerOrigin.receiptId);
  await assertNoUnappliedMerchantCharge(ctx, invoice.id);
  const scope = scopeSchema.parse(original.scope);
  const adapter = paymentAdapter(request.provider);
  if (!adapter.capabilities().sellerMerchantCharges || scope.destinationAccountId && !adapter.capabilities().destinationMerchantCharges) throw new ServiceError("conflict", "The original agreement collection method is unavailable.");
  const policy = await ctx.callAsSystem(getInvoiceMarketPolicy, { invoiceId: invoice.id });
  if (!policy || policy.model !== "seller_merchant" || policy.siteFeeBps !== original.siteFeeBps) throw new ServiceError("conflict", "The original agreement and invoice fee terms need reconciliation.");
  if (request.method === "provider_schedule") {
    if (ctx.actor.kind !== "system" || !original.providerOrigin || original.providerOrigin.providerApiVersion !== "2026-10-28.endive") throw new ServiceError("permission", "A scheduled renewal requires its durable original provider charge receipt.");
  } else {
    const due = await invoicePaymentDueAmount(invoice, ctx);
    if (due === null || request.amountMinor > due) throw new ServiceError("conflict", "This agreement payment exceeds the amount currently released for collection.");
    await verifyInvoiceMerchant(invoice.id, ctx);
  }
  const previous = await commercialInvoiceCashHistory(ctx, invoice);
  if (previous.pending || previous.cash !== BigInt(invoice.paidMinor)) throw new ServiceError("conflict", "Reconcile original refunded or outstanding agreement principal before another attempt.");
  const { feeMinor } = await invoiceCashFeeAllocation(ctx, invoice, policy.feeMinor, { amountMinor: request.amountMinor, priorCashMinor: Number(previous.cash), priorAllocatedFeeMinor: Number(previous.allocatedFee) });
  if (feeMinor < 0 || feeMinor > request.amountMinor) throw new ServiceError("conflict", "The original agreement application fee needs reconciliation.");
  return { ...scope, providerAccountId: scope.providerAccountId ?? "", applicationFeeMinor: feeMinor, agreementSubscriptionId: original.subscriptionId,
    ...(request.method === "provider_schedule" && original.providerOrigin ? { ...original.providerOrigin, originalChargeReceiptId: original.providerOrigin.receiptId } : {}) };
}

export async function agreementRoutingForPayment(ctx: ServiceContext, paymentId: string) {
  const [agreement] = await ctx.tx.select().from(merchantAgreementPaymentRoutes).where(eq(merchantAgreementPaymentRoutes.paymentId, paymentId));
  if (!agreement) return null;
  return { providerApiVersion: agreement.providerApiVersion ?? undefined, providerPlatformAccountId: agreement.providerPlatformAccountId, providerAccountId: agreement.chargeAccountId ?? undefined,
    ...(agreement.collectionKind === "destination" ? { destinationAccountId: agreement.recipientAccountId, settlementMerchantAccountId: agreement.settlementMerchantAccountId } : {}),
    applicationFeeMinor: agreement.applicationFeeMinor, agreementSubscriptionId: agreement.subscriptionId,
    providerSubscriptionRef: agreement.providerSubscriptionRef ?? undefined, providerInvoiceRef: agreement.providerInvoiceRef ?? undefined, providerPaymentIntentRef: agreement.providerPaymentIntentRef ?? undefined, providerChargeRef: agreement.providerChargeRef ?? undefined, originalChargeReceiptId: agreement.originalChargeReceiptId ?? undefined };
}
