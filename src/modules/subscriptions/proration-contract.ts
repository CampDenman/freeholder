// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C9.33/C9.38/C12.38: backend calendars and actual provider previews are distinct evidence.
import { z } from "zod";
import { ServiceError } from "@/core/service";
import { periodEnd } from "./calendar";
const sha = z.string().regex(/^[a-f0-9]{64}$/), minor = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export function reviewedProrationCalendar(input: { billingMode: "manual" | "platform" | "provider"; policy: "none" | "create_prorations";
  status: "active" | "trialing"; currentPeriodStart: Date; currentPeriodEnd: Date; trialEndsAt: Date | null; at: Date;
  nextInterval: "day" | "week" | "month" | "year"; nextIntervalCount: number }) {
  if (![input.currentPeriodStart, input.currentPeriodEnd, input.at].every(value => Number.isFinite(value.getTime()))
    || input.currentPeriodEnd <= input.currentPeriodStart || input.at < input.currentPeriodStart || input.at >= input.currentPeriodEnd) throw new ServiceError("conflict", "Review a current original period; missed boundaries require explicit fresh calendar consent.");
  if (input.status === "trialing") {
    if (!input.trialEndsAt || input.trialEndsAt.getTime() !== input.currentPeriodEnd.getTime()) throw new ServiceError("conflict", "Restore the actually accepted original trial end before changing its plan.");
    return { kind: "preserve_trial" as const, trialEndsAt: input.trialEndsAt.toISOString(), chargeMinor: 0 as const, oldPaidCreditMinor: 0 as const,
      nextPeriodStart: input.currentPeriodEnd.toISOString(), nextPeriodEnd: periodEnd(input.currentPeriodEnd, input.nextInterval, input.nextIntervalCount).toISOString() };
  }
  if (input.policy === "none") return { kind: "period_end" as const, nextPeriodStart: input.currentPeriodEnd.toISOString(),
    nextPeriodEnd: periodEnd(input.currentPeriodEnd, input.nextInterval, input.nextIntervalCount).toISOString() };
  if (input.billingMode === "provider") return { kind: "actual_provider_preview" as const, prorationAt: input.at.toISOString() };
  return { kind: "original_calendar" as const, prorationAt: input.at.toISOString(), currentPeriodStart: input.currentPeriodStart.toISOString(), currentPeriodEnd: input.currentPeriodEnd.toISOString(),
    nextPeriodStart: input.currentPeriodEnd.toISOString(), nextPeriodEnd: periodEnd(input.currentPeriodEnd, input.nextInterval, input.nextIntervalCount).toISOString() };
}
/** Internal actual-producer contract. A caller-supplied object is never accepted
 * as bank evidence or permission to write accepted terms or canonical money. */
export const providerProrationPreviewRequest = z.object({ version: z.literal(1), operationId: z.uuid(), subscriptionId: z.uuid(), generationId: z.uuid(), previousTermsId: z.uuid(),
  providerScheduleOperationId: z.uuid(), providerScheduleRef: z.string().regex(/^sub_sched_[A-Za-z0-9]+$/), providerSubscriptionRef: z.string().regex(/^sub_[A-Za-z0-9]+$/),
  providerCustomerRef: z.string().regex(/^cus_[A-Za-z0-9]+$/), providerItemRef: z.string().min(1).max(200),
  providerPlatformAccountId: z.string().regex(/^acct_[A-Za-z0-9]+$/), chargeAccountId: z.string().regex(/^acct_[A-Za-z0-9]+$/).nullable(),
  recipientAccountId: z.string().regex(/^acct_[A-Za-z0-9]+$/), settlementMerchantAccountId: z.string().regex(/^acct_[A-Za-z0-9]+$/),
  providerApiVersion: z.literal("2026-10-28.endive"), prorationAt: z.iso.datetime(), originalPeriodStart: z.iso.datetime(), originalPeriodEnd: z.iso.datetime(),
  operationRevision: z.number().int().nonnegative(), evidenceRevision: z.number().int().nonnegative(), originalJournalDigest: sha,
  currentResourceDigest: sha, originalPaidInvoiceId: z.uuid().nullable(), originalCreditCapacityDigest: sha,
  proposedPriceDigest: sha, proposedTaxQuoteDigest: sha, originalFeePolicyDigest: sha,
}).strict();
export const providerProrationPreviewObservation = z.object({ version: z.literal(1), operationId: z.uuid(), requestDigest: sha,
  providerPreviewRef: z.string().min(1).max(300), providerSubscriptionRef: z.string().regex(/^sub_[A-Za-z0-9]+$/), providerCustomerRef: z.string().regex(/^cus_[A-Za-z0-9]+$/),
  prorationAt: z.iso.datetime(), originalPeriodStart: z.iso.datetime(), originalPeriodEnd: z.iso.datetime(), proposedPeriodStart: z.iso.datetime(), proposedPeriodEnd: z.iso.datetime(),
  proposedBillingAnchor: z.iso.datetime(), originalTrialEndsAt: z.iso.datetime().nullable(), proposedTrialEndsAt: z.iso.datetime().nullable(),
  currency: z.string().regex(/^[A-Z]{3}$/), debitMinor: minor, creditMinor: minor, amountDueMinor: minor,
  complete: z.literal(true), lines: z.array(z.object({ providerLineRef: z.string().min(1).max(300), component: z.enum(["debit", "credit"]),
    amountMinor: minor, periodStart: z.iso.datetime(), periodEnd: z.iso.datetime(), originalProviderInvoiceRef: z.string().min(1).max(300).nullable(),
    originalProviderInvoiceLineRef: z.string().min(1).max(300).nullable(), actual: z.record(z.string(), z.unknown()) }).strict()).max(1000),
  actual: z.record(z.string(), z.unknown()),
}).strict().superRefine((value, context) => {
  if (Buffer.byteLength(JSON.stringify(value)) > 4 * 1024 * 1024) context.addIssue({ code: "custom", message: "The complete actual preview exceeds its bounded evidence budget." });
  if (value.originalTrialEndsAt && value.proposedTrialEndsAt !== value.originalTrialEndsAt) context.addIssue({ code: "custom", message: "An ordinary plan change cannot silently end or extend the accepted trial." });
});
