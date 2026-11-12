// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.26/C12.38: a new agreement's payment never invents an order allocation.
import { sql } from "drizzle-orm";
import { bigint, check, index, integer, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAtColumn } from "@/core/db/columns";
import { subscriptions, subscriptionProviderChargeReceipts } from "@/modules/subscriptions/schema";
import { payments } from "./schema";

export const merchantAgreementPaymentRoutes = pgTable("merchant_agreement_payment_routes", {
  paymentId: uuid("payment_id").primaryKey().references(() => payments.id, { onDelete: "restrict" }),
  subscriptionId: uuid("subscription_id").notNull().references(() => subscriptions.id, { onDelete: "restrict" }),
  agreementRoutingVersion: integer("agreement_routing_version").notNull().default(1),
  collectionKind: text("collection_kind", { enum: ["direct", "destination"] }).notNull(),
  providerPlatformAccountId: text("provider_platform_account_id").notNull(),
  chargeAccountId: text("charge_account_id"),
  recipientAccountId: text("recipient_account_id").notNull(),
  settlementMerchantAccountId: text("settlement_merchant_account_id").notNull(),
  applicationFeeMinor: bigint("application_fee_minor", { mode: "number" }).notNull(),
  providerApiVersion: text("provider_api_version", { enum: ["2026-10-28.endive"] }),
  originKind: text("origin_kind", { enum: ["attempt", "provider_schedule"] }).notNull(),
  providerSubscriptionRef: text("provider_subscription_ref"),
  providerInvoiceRef: text("provider_invoice_ref"),
  providerPaymentIntentRef: text("provider_payment_intent_ref"),
  providerChargeRef: text("provider_charge_ref"),
  originalChargeReceiptId: uuid("original_charge_receipt_id").references(() => subscriptionProviderChargeReceipts.id, { onDelete: "restrict" }),
  createdAt: createdAtColumn(),
}, (t) => [
  index("merchant_agreement_payment_routes_subscription_idx").on(t.subscriptionId),
  uniqueIndex("merchant_agreement_payment_routes_receipt_idx").on(t.originalChargeReceiptId),
  check("merchant_agreement_payment_routes_version", sql`${t.agreementRoutingVersion} = 1`),
  check("merchant_agreement_payment_routes_fee", sql`${t.applicationFeeMinor} >= 0`),
  check("merchant_agreement_payment_routes_scope", sql`${t.providerPlatformAccountId} ~ '^acct_[A-Za-z0-9]+$' and ${t.recipientAccountId} ~ '^acct_[A-Za-z0-9]+$'
    and ${t.recipientAccountId} <> ${t.providerPlatformAccountId} and ${t.settlementMerchantAccountId} = ${t.recipientAccountId}
    and ((${t.collectionKind} = 'direct' and ${t.chargeAccountId} is not null and ${t.chargeAccountId} = ${t.recipientAccountId}) or (${t.collectionKind} = 'destination' and ${t.chargeAccountId} is null))`),
  check("merchant_agreement_payment_routes_origin", sql`(${t.originKind} = 'attempt' and ${t.providerApiVersion} is null and ${t.providerSubscriptionRef} is null and ${t.providerInvoiceRef} is null and ${t.providerPaymentIntentRef} is null and ${t.providerChargeRef} is null and ${t.originalChargeReceiptId} is null)
    or (${t.originKind} = 'provider_schedule' and ${t.providerApiVersion} = '2026-10-28.endive' and ${t.providerSubscriptionRef} is not null and ${t.providerInvoiceRef} is not null and ${t.providerPaymentIntentRef} is not null and ${t.providerChargeRef} is not null and ${t.originalChargeReceiptId} is not null)`),
]);
