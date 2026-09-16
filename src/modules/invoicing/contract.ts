// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Shared invoicing service output shapes (C3.01).
import { z } from "zod";
import { listed, row, timestamp, uuid } from "@/core/contract";

const money = z.number().int();
const nullableMoney = money.nullable();

export const taxCategoryRow = row({
  id: uuid,
  code: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  defaultRateHintPpm: z.number().int().nullable(),
  active: z.boolean(),
  createdAt: timestamp,
  updatedAt: timestamp,
});

export const taxZoneRow = row({
  id: uuid,
  name: z.string(),
  templateKey: z.string().nullable(),
  templateVersion: z.number().int().nullable(),
  country: z.string(),
  regions: listed(z.string()),
  postalPatterns: listed(z.string()),
  priority: z.number().int(),
  basis: z.enum(["origin", "destination"]),
  pricesIncludeTax: z.boolean(),
  roundingScope: z.enum(["line", "invoice"]),
  roundingMode: z.enum(["half_up", "bankers"]),
  active: z.boolean(),
  createdAt: timestamp,
  updatedAt: timestamp,
});

export const taxRateRow = row({
  id: uuid,
  zoneId: uuid,
  categoryId: uuid.nullable(),
  name: z.string(),
  jurisdiction: z.string(),
  ratePpm: z.number().int(),
  compound: z.boolean(),
  priority: z.number().int(),
  appliesToShipping: z.boolean(),
  effectiveFrom: z.string().nullable(),
  effectiveTo: z.string().nullable(),
  active: z.boolean(),
  createdAt: timestamp,
  updatedAt: timestamp,
});

export const taxRegistrationRow = row({
  id: uuid,
  zoneId: uuid,
  number: z.string().nullable(),
  scheme: z.enum(["standard", "oss", "ioss", "simplified"]),
  collectsFrom: z.string().nullable(),
  thresholdMinor: money,
  thresholdCurrency: z.string().nullable(),
  status: z.enum(["monitoring", "active", "paused", "closed"]),
  createdAt: timestamp,
  updatedAt: timestamp,
});

export const taxExemptionRow = row({
  id: uuid,
  contactId: uuid,
  zoneId: uuid,
  kind: z.enum(["reseller", "nonprofit", "reverse_charge", "diplomatic"]),
  certificateRef: z.string().nullable(),
  validatedAt: timestamp.nullable(),
  expiresAt: timestamp.nullable(),
  status: z.enum(["pending", "valid", "expired", "revoked"]),
  createdAt: timestamp,
  updatedAt: timestamp,
});

export const publicTaxTemplate = z.object({
  key: z.string(),
  version: z.number().int(),
  group: z.enum([
    "canada",
    "european_union",
    "united_kingdom",
    "united_states",
    "australia",
    "new_zealand",
  ]),
  name: z.string(),
  country: z.string(),
  regions: listed(z.string()),
  basis: z.enum(["origin", "destination"]),
  pricesIncludeTax: z.boolean(),
  roundingScope: z.enum(["line", "invoice"]),
  roundingMode: z.enum(["half_up", "bankers"]),
  rates: listed(
    z.object({
      name: z.string(),
      jurisdiction: z.string(),
      ratePpm: z.number().int(),
      appliesToShipping: z.boolean(),
      priority: z.number().int().optional(),
    }),
  ),
  source: z.object({
    authority: z.string(),
    url: z.string(),
    checkedOn: z.string(),
  }),
  activationLimitation: z.string().nullable(),
});

export const quotedTaxLine = z.object({
  itemId: z.string().optional(),
  jurisdiction: z.string(),
  name: z.string(),
  ratePartsPerMillion: z.number().int(),
  taxableMinor: money,
  taxMinor: money,
  inclusive: z.boolean(),
  compound: z.boolean(),
  priority: z.number().int(),
});

export const taxQuote = z.object({
  provider: z.string(),
  currency: z.string(),
  lines: listed(quotedTaxLine),
  totalTaxMinor: money,
  includedTaxMinor: money,
  explanation: listed(z.string()),
  zone: z.object({ id: uuid, name: z.string() }).nullable(),
  registration: z.object({ id: uuid, number: z.string().nullable() }).nullable(),
  exemption: z.object({ id: uuid, kind: z.string() }).nullable(),
});

export const invoiceRow = row({
  id: uuid,
  contactId: uuid,
  number: z.string().nullable(),
  sequenceKey: z.string(),
  sourceType: z.enum([
    "order",
    "quote",
    "booking",
    "subscription",
    "manual",
    "deposit",
    "balance",
    "tip",
    "pay_what_you_want",
    "late_fee",
    "unlock",
    "ad_campaign",
  ]),
  sourceId: z.string().nullable(),
  idempotencyKey: z.string(),
  requestHash: z.string(),
  status: z.enum([
    "draft",
    "sent",
    "viewed",
    "partially_paid",
    "paid",
    "overdue",
    "void",
    "refunded",
  ]),
  currency: z.string(),
  subtotalMinor: money,
  discountMinor: money,
  shippingMinor: money,
  taxMinor: money,
  taxZoneId: uuid.nullable(),
  totalMinor: money,
  paidMinor: money,
  refundedMinor: money,
  billingAddress: z.unknown().nullable(),
  customerTaxId: z.string().nullable(),
  requiredTaxLegend: z.string().nullable(),
  memo: z.string().nullable(),
  schedule: z.unknown().nullable(),
  depositOfInvoiceId: uuid.nullable(),
  dueAt: timestamp.nullable(),
  issuedAt: timestamp.nullable(),
  viewedAt: timestamp.nullable(),
  paidAt: timestamp.nullable(),
  voidedAt: timestamp.nullable(),
  createdAt: timestamp,
  updatedAt: timestamp,
});

export const invoiceLineRow = row({
  id: uuid,
  invoiceId: uuid,
  position: z.number().int(),
  sourceType: z.string().nullable(),
  sourceId: z.string().nullable(),
  description: z.string(),
  quantityMicros: z.number().int(),
  unitAmountMinor: money,
  subtotalMinor: money,
  discountMinor: money,
  taxMinor: money,
  totalMinor: money,
  taxCategoryCode: z.string(),
  snapshot: z.unknown(),
  createdAt: timestamp,
});

export const taxLineRow = row({
  id: uuid,
  invoiceId: uuid,
  invoiceLineId: uuid.nullable(),
  kind: z.enum(["item", "shipping", "exemption"]),
  rateName: z.string(),
  ratePpm: z.number().int(),
  taxableMinor: money,
  amountMinor: money,
  jurisdiction: z.string(),
  registrationNumber: z.string().nullable(),
  inclusive: z.boolean(),
  compound: z.boolean(),
  priority: z.number().int(),
  exemptionKind: z.string().nullable(),
  explanation: z.string(),
  createdAt: timestamp,
});

export const paymentRow = row({
  id: uuid,
  invoiceId: uuid,
  provider: z.string(),
  providerCheckoutRef: z.string().nullable(),
  providerRef: z.string().nullable(),
  idempotencyKey: z.string(),
  requestHash: z.string(),
  status: z.enum(["created", "processing", "succeeded", "failed", "cancelled"]),
  method: z.string(),
  currency: z.string(),
  amountMinor: money,
  refundedMinor: money,
  failureCode: z.string().nullable(),
  failureMessage: z.string().nullable(),
  processedAt: timestamp.nullable(),
  failedAt: timestamp.nullable(),
  metadata: z.unknown(),
  createdAt: timestamp,
  updatedAt: timestamp,
});

export const refundRow = row({
  id: uuid,
  paymentId: uuid,
  invoiceId: uuid,
  provider: z.string(),
  providerRef: z.string().nullable(),
  idempotencyKey: z.string(),
  requestHash: z.string(),
  status: z.enum(["created", "processing", "succeeded", "failed", "cancelled"]),
  currency: z.string(),
  amountMinor: money,
  reason: z.string().nullable(),
  failureCode: z.string().nullable(),
  failureMessage: z.string().nullable(),
  processedAt: timestamp.nullable(),
  failedAt: timestamp.nullable(),
  createdAt: timestamp,
  updatedAt: timestamp,
});

export const creditNoteRow = row({
  id: uuid,
  invoiceId: uuid,
  number: z.string().nullable(),
  sequenceKey: z.string(),
  idempotencyKey: z.string(),
  requestHash: z.string(),
  status: z.enum(["draft", "issued", "void"]),
  currency: z.string(),
  reason: z.string(),
  subtotalMinor: money,
  taxMinor: money,
  totalMinor: money,
  issuedAt: timestamp.nullable(),
  voidedAt: timestamp.nullable(),
  createdAt: timestamp,
  updatedAt: timestamp,
});

export const invoiceBundle = z.object({
  invoice: invoiceRow,
  lines: listed(invoiceLineRow),
  taxLines: listed(taxLineRow),
  payments: listed(paymentRow),
  refunds: listed(refundRow),
  creditNotes: listed(creditNoteRow),
});

export const paymentReceipt = z.object({
  receiptNumber: z.string(),
  issuedAt: timestamp,
  invoice: z.object({
    id: uuid,
    number: z.string(),
    issuedAt: timestamp,
    currency: z.string(),
    totalMinor: money,
  }),
  customer: z.object({
    id: uuid,
    name: z.string().nullable(),
    email: z.string().nullable(),
  }),
  payment: z.object({
    id: uuid,
    provider: z.string(),
    providerRef: z.string(),
    method: z.string(),
    amountMinor: money,
    refundedMinor: money,
    netMinor: money,
  }),
  lines: listed(invoiceLineRow),
  taxLines: listed(taxLineRow),
  refunds: listed(refundRow),
  requiredTaxLegend: z.string().nullable(),
});

export const paymentMethodRow = row({
  id: uuid,
  contactId: uuid,
  provider: z.string(),
  providerMethodRef: z.string(),
  providerCustomerRef: z.string().nullable(),
  kind: z.enum([
    "card",
    "wallet",
    "bank_debit",
    "bank_redirect",
    "buy_now_pay_later",
    "cash",
    "bank_transfer",
    "other",
  ]),
  label: z.string(),
  brand: z.string().nullable(),
  last4: z.string().nullable(),
  expiryMonth: z.number().int().nullable(),
  expiryYear: z.number().int().nullable(),
  status: z.enum(["active", "revoked", "expired"]),
  consentSource: z.string(),
  consentedAt: timestamp,
  providerStatusAt: timestamp,
  revokedAt: timestamp.nullable(),
  createdAt: timestamp,
  updatedAt: timestamp,
});

export const paymentDisputeRow = row({
  id: uuid,
  paymentId: uuid,
  invoiceId: uuid,
  provider: z.string(),
  providerRef: z.string(),
  providerPaymentRef: z.string(),
  status: z.enum(["open", "won", "lost"]),
  currency: z.string(),
  amountMinor: money,
  reason: z.string().nullable(),
  evidenceDueAt: timestamp.nullable(),
  openedAt: timestamp,
  providerStatusAt: timestamp,
  closedAt: timestamp.nullable(),
  createdAt: timestamp,
  updatedAt: timestamp,
});

export const paymentProviderEventRow = row({
  id: uuid,
  provider: z.string(),
  providerEventId: z.string(),
  kind: z.string(),
  providerObjectRef: z.string().nullable(),
  bodySha256: z.string(),
  status: z.enum(["processed", "ignored"]),
  detail: z.string().nullable(),
  occurredAt: timestamp,
  receivedAt: timestamp,
  processedAt: timestamp,
});

export const paymentPlanRow = row({
  id: uuid,
  invoiceId: uuid,
  idempotencyKey: z.string(),
  requestHash: z.string(),
  status: z.enum(["active", "completed", "defaulted", "cancelled"]),
  currency: z.string(),
  principalMinor: money,
  paidMinor: money,
  cancelledAt: timestamp.nullable(),
  createdAt: timestamp,
  updatedAt: timestamp,
});

export const paymentPlanInstallmentRow = row({
  id: uuid,
  planId: uuid,
  position: z.number().int(),
  dueAt: timestamp,
  amountMinor: money,
  paidMinor: money,
  status: z.enum(["scheduled", "due", "partially_paid", "paid", "waived", "defaulted"]),
  createdAt: timestamp,
  updatedAt: timestamp,
});

export const paymentAllocationRow = row({
  id: uuid,
  paymentId: uuid,
  installmentId: uuid,
  amountMinor: money,
  createdAt: timestamp,
});

export const customerBalanceAccountRow = row({
  id: uuid,
  contactId: uuid,
  currency: z.string(),
  balanceMinor: money,
  createdAt: timestamp,
  updatedAt: timestamp,
});

export const customerBalanceEntryRow = row({
  id: uuid,
  accountId: uuid,
  kind: z.enum(["credit", "debit", "refund", "adjustment"]),
  deltaMinor: money,
  balanceAfterMinor: money,
  sourceType: z.string(),
  sourceId: z.string().nullable(),
  idempotencyKey: z.string(),
  requestHash: z.string(),
  reason: z.string(),
  actor: z.string(),
  createdAt: timestamp,
});

export const flexiblePaymentRow = row({
  id: uuid,
  invoiceId: uuid,
  attachedInvoiceId: uuid.nullable(),
  kind: z.enum(["tip", "pay_what_you_want"]),
  context: z.enum(["checkout", "invoice", "gallery", "booking", "store", "other"]),
  chosenMinor: money,
  minimumMinor: money,
  maximumMinor: nullableMoney,
  message: z.string().nullable(),
  idempotencyKey: z.string(),
  requestHash: z.string(),
  createdAt: timestamp,
});

export const lateFeeAssessmentRow = row({
  id: uuid,
  sourceInvoiceId: uuid,
  feeInvoiceId: uuid,
  basis: z.enum(["fixed", "percentage"]),
  outstandingMinor: money,
  fixedMinor: nullableMoney,
  ratePpm: z.number().int().nullable(),
  capMinor: nullableMoney,
  graceDays: z.number().int(),
  assessedMinor: money,
  assessedAt: timestamp,
  reason: z.string(),
  idempotencyKey: z.string(),
  requestHash: z.string(),
  createdAt: timestamp,
});

export const providerBalanceTransactionRow = row({
  id: uuid,
  provider: z.string(),
  providerRef: z.string(),
  kind: z.enum(["charge", "refund", "dispute", "fee", "adjustment", "reserve", "release"]),
  sourceType: z.string().nullable(),
  sourceId: uuid.nullable(),
  currency: z.string(),
  grossMinor: money,
  feeMinor: money,
  netMinor: money,
  availableAt: timestamp.nullable(),
  occurredAt: timestamp,
  metadata: z.unknown(),
  requestHash: z.string(),
  createdAt: timestamp,
});

export const providerPayoutRow = row({
  id: uuid,
  provider: z.string(),
  providerRef: z.string(),
  status: z.enum(["pending", "in_transit", "paid", "failed", "cancelled"]),
  currency: z.string(),
  amountMinor: money,
  statementRef: z.string().nullable(),
  failureReason: z.string().nullable(),
  expectedAt: timestamp.nullable(),
  providerStatusAt: timestamp,
  paidAt: timestamp.nullable(),
  reconciledAt: timestamp.nullable(),
  createdAt: timestamp,
  updatedAt: timestamp,
});

export const adapterStatus = z.object({
  family: z.string(),
  id: z.string(),
  available: z.boolean(),
  message: z.string(),
});

export const posCollection = z.object({
  providerRef: z.string(),
  status: z.enum(["requires_reader", "processing", "succeeded", "failed"]),
  readerActionToken: z.string().optional(),
});

export const checkoutSession = z.object({
  providerRef: z.string(),
  paymentRef: z.string().optional(),
  url: z.string(),
  expiresAt: z.string().optional(),
});
