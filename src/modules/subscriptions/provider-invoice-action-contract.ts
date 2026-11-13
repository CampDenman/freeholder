// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38/C1.08: only complete actual invoice/PI inventory authorizes a stop action.
import { z } from "zod";
import { providerPhase } from "./provider-phase-contract";
const ref = (prefix: string) => z.string().regex(new RegExp(`^${prefix}_[A-Za-z0-9]{1,195}$`));
const minor = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const originalProviderInvoice = z.object({ providerInvoiceRef: ref("in"), state: z.enum(["paid", "void", "draft", "open", "uncollectible"]),
  currency: z.string().regex(/^[A-Z]{3}$/), totalMinor: minor, paidMinor: minor, remainingMinor: minor, periodStart: z.iso.datetime(), complete: z.literal(true),
  paymentIntents: z.array(z.object({ providerPaymentIntentRef: ref("pi"), state: z.string(), amountMinor: minor, receivedMinor: minor, currency: z.string().regex(/^[A-Z]{3}$/) })).max(2000) });
export const originalProviderInvoiceInventory = z.object({ providerSubscriptionRef: ref("sub"), state: z.enum(["paused", "cancelled"]), invoices: z.array(originalProviderInvoice).max(2000) });
export const invoiceActionRequest = z.object({ subscriptionId: z.uuid(), providerSubscriptionRef: ref("sub"), providerCustomerRef: ref("cus"),
  providerScheduleRefs: z.array(ref("sub_sched")).max(5000).optional(), providerScheduleOperationId: z.uuid().optional(),
  providerPlatformAccountId: ref("acct"), providerAccountId: ref("acct").optional(), destinationAccountId: ref("acct").optional(), settlementMerchantAccountId: ref("acct").optional(),
  providerScheduleApiVersion: z.literal("2026-10-28.endive"), providerInvoiceRef: ref("in"), action: z.enum(["cancel_intent", "void_invoice", "finalize_draft"]), providerPaymentIntentRef: ref("pi").optional(),
  admittedPhase: providerPhase.extend({ providerPriceRef: ref("price") }).optional() });
export const invoiceActionAcknowledgment = z.discriminatedUnion("action", [
  z.object({ action: z.literal("cancel_intent"), providerInvoiceRef: ref("in"), providerPaymentIntentRef: ref("pi"), state: z.literal("canceled") }),
  z.object({ action: z.literal("void_invoice"), providerInvoiceRef: ref("in"), state: z.literal("void") }),
  z.object({ action: z.literal("finalize_draft"), providerInvoiceRef: ref("in"), state: z.enum(["open", "paid", "void"]), autoAdvance: z.literal(false) }),
]);
/** A positive/processing charge is money recovery, never permission to erase an
 * invoice. Draft subscription invoices cannot be deleted by Stripe's API. */
export function invoiceStopAction(invoice: z.infer<typeof originalProviderInvoice>): { action: "cancel_intent"; providerPaymentIntentRef: string } | { action: "void_invoice" } | { action: "finalize_draft" } | null {
  if (!invoice.complete || invoice.paidMinor !== 0
    || invoice.state !== "void" && BigInt(invoice.totalMinor) !== BigInt(invoice.paidMinor) + BigInt(invoice.remainingMinor)
    || invoice.paymentIntents.reduce((sum, intent) => sum + BigInt(intent.receivedMinor), 0n) !== BigInt(invoice.paidMinor) || invoice.paymentIntents.some(intent => intent.receivedMinor !== 0 || intent.currency !== invoice.currency)
    || new Set(invoice.paymentIntents.map(intent => intent.providerPaymentIntentRef)).size !== invoice.paymentIntents.length) return null;
  const pending = invoice.paymentIntents.find(intent => ["requires_payment_method", "requires_confirmation", "requires_action", "requires_capture"].includes(intent.state));
  if (pending) return { action: "cancel_intent", providerPaymentIntentRef: pending.providerPaymentIntentRef };
  if (invoice.paymentIntents.some(intent => intent.state !== "canceled")) return null;
  if (invoice.state === "draft") return { action: "finalize_draft" };
  return ["open", "uncollectible"].includes(invoice.state) ? { action: "void_invoice" } : null;
}
