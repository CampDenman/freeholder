// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C12.38/C1.08: genuine independent effect proof, not previous cash authority.
import { merchantTaxDigest } from "@/modules/invoicing/merchant-tax-store";
import { originalCashEvidenceKeys, originalCashSigningKey } from "@/modules/invoicing/original-cash-recovery-store";
import { signOriginalCashRecovery, verifyOriginalCashRecovery } from "@/modules/invoicing/original-cash-recovery-proof";
import type { subscriptionControlledPaidPeriodReceipts } from "./controlled-provider-paid-period-schema";
type Receipt = typeof subscriptionControlledPaidPeriodReceipts.$inferSelect;
export const CONTROLLED_PAID_PERIOD_PROTOCOL = "controlled_paid_period.v1";
export function controlledPaidPeriodBody(row: Omit<Receipt, "digest" | "authentication">) {
  return { protocol: row.protocol, admissionTransactionId: row.admissionTransactionId, collectionId: row.collectionId, resourceId: row.resourceId,
    subscriptionId: row.subscriptionId, invoiceId: row.invoiceId, termsId: row.termsId, renewalEventId: row.renewalEventId, planEventId: row.planEventId,
    planId: row.planId, productVariantId: row.productVariantId, acceptedQuoteDigest: row.acceptedQuoteDigest, canonicalTargetDigest: row.canonicalTargetDigest,
    parentRevision: row.parentRevision, beforeParentFingerprint: row.beforeParentFingerprint, beforeEntries: row.beforeEntries, beforeParentFields: row.beforeParentFields,
    bankRevisions: row.bankRevisions, periodStart: row.periodStart, periodEnd: row.periodEnd, effectAt: row.effectAt, financialReviewPending: row.financialReviewPending };
}
export function signControlledPaidPeriod(row: Omit<Receipt, "digest" | "authentication">) {
  const digest = merchantTaxDigest(controlledPaidPeriodBody(row));
  return { digest, authentication: signOriginalCashRecovery(CONTROLLED_PAID_PERIOD_PROTOCOL, { id: row.id, createdAt: row.createdAt, digest }, originalCashSigningKey()) };
}
export function verifiedControlledPaidPeriod(row: Receipt) { return verifyOriginalCashRecovery(CONTROLLED_PAID_PERIOD_PROTOCOL, row, controlledPaidPeriodBody(row), originalCashEvidenceKeys()); }
