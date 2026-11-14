// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C12.38: private authentic parent admissions, never a marker-only allowed flag.
import type { controlledCashApplicationBatches,controlledCashApplicationReceipts } from "./controlled-cash-application-protocol-schema";
import { merchantTaxDigest } from "./merchant-tax-store";
import { originalCashEvidenceKeys,originalCashSigningKey } from "./original-cash-recovery-store";
import { signOriginalCashRecovery,verifyOriginalCashRecovery } from "./original-cash-recovery-proof";
import { isControlledCashApplicationProtocol } from "./controlled-cash-application-protocol";
type Batch=typeof controlledCashApplicationBatches.$inferSelect;
type Receipt=typeof controlledCashApplicationReceipts.$inferSelect;
const BATCH="controlled_cash_application_batch.v1",RECEIPT="controlled_cash_application_receipt.v1";
/** Explicit body excludes only its signature envelope. The actual recorded
 * before timestamp strings retain full PostgreSQL precision. No stored claim
 * becomes current bank/parent authority without the independent live checks. */
export function controlledCashBatchBody(row:Omit<Batch,"digest"|"authentication">){return{
 collectionId:row.collectionId,quoteId:row.quoteId,resourceId:row.resourceId,subscriptionId:row.subscriptionId,invoiceId:row.invoiceId,termsId:row.termsId,protocol:row.protocol,admissionTransactionId:row.admissionTransactionId,
 bankRevision:row.bankRevision,parentRevision:row.parentRevision,parentPgRevision:row.parentPgRevision,preApplicationRevision:row.preApplicationRevision,acceptedQuoteDigest:row.acceptedQuoteDigest,canonicalTargetDigest:row.canonicalTargetDigest,
 beforeEntries:row.beforeEntries,mutableBeforeRows:row.mutableBeforeRows,requestedReceiptIds:row.requestedReceiptIds,rawBindings:row.rawBindings,invoiceBeforeFingerprint:row.invoiceBeforeFingerprint,invoiceBeforeStatus:row.invoiceBeforeStatus,
 invoiceBeforePaidMinor:row.invoiceBeforePaidMinor,invoiceBeforeCreditedMinor:row.invoiceBeforeCreditedMinor,invoiceBeforeRefundedMinor:row.invoiceBeforeRefundedMinor,invoiceBeforePaidAt:row.invoiceBeforePaidAt,invoiceBeforeUpdatedAt:row.invoiceBeforeUpdatedAt,
 expectedCashMinor:row.expectedCashMinor,expectedFeeMinor:row.expectedFeeMinor,currency:row.currency,
};}
export function controlledCashReceiptBody(row:Omit<Receipt,"digest"|"authentication">){return{
 batchId:row.batchId,receiptId:row.receiptId,ordinal:row.ordinal,originalObservationId:row.originalObservationId,originOperationId:row.originOperationId,originCallId:row.originCallId,originFactId:row.originFactId,
 bankInspectionId:row.bankInspectionId,bankObservationId:row.bankObservationId,bankFinishCallerId:row.bankFinishCallerId,immutableBankRevision:row.immutableBankRevision,namespaceRevision:row.namespaceRevision,receiptFingerprint:row.receiptFingerprint,
 originalObservationIds:row.originalObservationIds,amountMinor:row.amountMinor,currency:row.currency,priorCashMinor:row.priorCashMinor,priorAllocatedFeeMinor:row.priorAllocatedFeeMinor,feeMinor:row.feeMinor,
 feeAllocationRevision:row.feeAllocationRevision,paymentEvidenceDigest:row.paymentEvidenceDigest,paymentIdempotencyKey:row.paymentIdempotencyKey,paymentRequestHash:row.paymentRequestHash,processedAt:row.processedAt,
};}
export function signControlledCashBatch(row:Omit<Batch,"digest"|"authentication">){const digest=merchantTaxDigest(controlledCashBatchBody(row));return{digest,authentication:signOriginalCashRecovery(BATCH,{id:row.id,createdAt:row.createdAt,digest},originalCashSigningKey())};}
export function signControlledCashReceipt(row:Omit<Receipt,"digest"|"authentication">){const digest=merchantTaxDigest(controlledCashReceiptBody(row));return{digest,authentication:signOriginalCashRecovery(RECEIPT,{id:row.id,createdAt:row.createdAt,digest},originalCashSigningKey())};}
export function verifiedControlledCashBatch(row:Batch){return isControlledCashApplicationProtocol(row.protocol)&&verifyOriginalCashRecovery(BATCH,row,controlledCashBatchBody(row),originalCashEvidenceKeys());}
export function verifiedControlledCashReceipt(row:Receipt){return verifyOriginalCashRecovery(RECEIPT,row,controlledCashReceiptBody(row),originalCashEvidenceKeys());}
