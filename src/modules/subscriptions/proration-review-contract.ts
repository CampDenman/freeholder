// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Ordinary shared gross-proration DTOs; unchanged shapes, no collector import.
import { z } from "zod";
import { feeCollectionState } from "@/modules/invoicing/credit-fee-origin";
import { subscriptionTaxDestination } from "./merchant-scope-contract";
import { prorationCardSummary } from "./proration-card-contract";
import { publicMerchantTermsQuote } from "./merchant-terms-quote-contract";
const sha = z.string().regex(/^[a-f0-9]{64}$/), minor = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const grossProrationInput = z.object({ id: z.uuid(), planId: z.uuid(), productVariantId: z.uuid().optional(), effectiveAt: z.iso.datetime(),
  taxDestination: subscriptionTaxDestination, locale: z.enum(["en", "fr", "es", "ar"]).default("en") }).strict();
export const grossProrationReview = z.object({ subscriptionId: z.uuid(), previousTermsId: z.uuid(), quoteDigest: sha, sourceRevision: sha, effectiveAt: z.iso.datetime(),
  originalPeriodStart: z.iso.datetime(), originalPeriodEnd: z.iso.datetime(), originalTrialEndsAt: z.iso.datetime().nullable(),
  calendar: z.union([z.object({ kind: z.literal("preserve_trial"), trialEndsAt: z.iso.datetime(), chargeMinor: z.literal(0), oldPaidCreditMinor: z.literal(0), nextPeriodStart: z.iso.datetime(), nextPeriodEnd: z.iso.datetime() }),
    z.object({ kind: z.literal("original_calendar"), prorationAt: z.iso.datetime(), currentPeriodStart: z.iso.datetime(), currentPeriodEnd: z.iso.datetime(), nextPeriodStart: z.iso.datetime(), nextPeriodEnd: z.iso.datetime() })]),
  debitNetMinor: minor, debitTaxMinor: minor, creditNetMinor: minor, creditTaxMinor: minor, creditAppliedMinor: minor, cashDueMinor: minor,
  residualCreditMinor: minor, creditDisposition: z.literal("exclusive_until_paid_access_switch_no_automatic_cash_refund"),
  requiresMerchantReview: z.boolean(), payment: prorationCardSummary.nullable(),
  feeReview: z.object({ debitFeeObligationMinor: minor, creditFeeObligationMinor: minor, appliedFeeObligationMinor: minor, appliedFeeProvenCollectedMinor: minor,
    remainingNewCashFeeMinor: minor, separateMerchantReceivableMinor: minor, originalOverTargetMinor: minor, originalSourceDebt: z.boolean(), sources: z.array(z.object({ sourcePaymentId: z.uuid(), sourceApplicationId: z.uuid().nullable(),
      amountMinor: minor, feeObligationMinor: minor, feeProvenCollectedMinor: minor, feeCollectionState, feeEvidenceDigest: sha, feeUnexpected: z.boolean() })).max(1000) }).nullable(),
  quote: publicMerchantTermsQuote.unwrap(), noticeSnapshot: z.object({ locale: z.enum(["en", "fr", "es", "ar"]), text: z.string().min(1) }) });

