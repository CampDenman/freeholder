// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: actual refund facts commit before policy or invoice application.
import { merchantCashReturnInspectionStops } from "./merchant-cash-inspection-stop-schema";
import { queueOriginalMerchantRefundRepair } from "./merchant-refund-privacy-repair";
import { allowOriginalMerchantRefundWrites } from "./merchant-refund-store";
import { randomUUID } from "node:crypto";
import { STRIPE_REFUND_REFERENCE } from "@/adapters/payments/stripe-refund-reference";
import { and, eq, sql } from "drizzle-orm";
import { enqueueJob } from "@/core/jobs";
import { z } from "zod";
import { defineService, ServiceError } from "@/core/service";
import { subscriptionProviderChargeReceipts } from "@/modules/subscriptions/schema";
import { routingForPayment } from "./merchant-charge";
import { merchantCashReturnInspections, merchantRefundObservations, merchantRefundRequests, merchantRefundResourceBindings } from "./merchant-refund-schema";
import { merchantRefundObservationCaptures } from "./merchant-refund-current-schema";
import { merchantTaxDigest } from "./merchant-tax-store";
import { payments } from "./schema";
const reference = z.string().min(1).max(200), account = z.string().regex(/^acct_[A-Za-z0-9]+$/).max(200);
export const merchantRefundEvidence = z.object({
  providerRef: reference.regex(STRIPE_REFUND_REFERENCE), paymentProviderRef: reference.regex(/^pi_[A-Za-z0-9_]+$/).nullable(),
  providerPlatformAccountId: account, providerAccountId: account.optional(), providerApiVersion: z.string().min(1).max(100).nullable(),
  amountMinor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), currency: z.string().regex(/^[A-Z]{3}$/),
  status: z.enum(["pending", "requires_action", "succeeded", "failed", "canceled"]).nullable(), bindingVerified: z.boolean(),
  providerChargeRef: reference.optional(), transferReversalRef: reference.optional(), sourceTransferReversalRef: reference.optional(),
  failureCode: z.string().max(100).optional(), failureReason: z.string().max(100).optional(), failureBalanceTransactionRef: reference.optional(),
});
const source = z.discriminatedUnion("kind", [z.object({ kind: z.literal("payment"), paymentId: z.uuid() }),
  z.object({ kind: z.literal("subscription"), receiptId: z.uuid() })]);
export const recordMerchantRefundObservation = defineService({
  name: "invoicing.recordMerchantRefundObservation", summary: "Retain authenticated refund facts against their original cash owner before applying recovery policy.",
  kind: "mutation", permission: "system", external: false, writeClass: "money",
  input: z.object({ source, requestId: z.uuid().optional(), inspectionId: z.uuid().optional(), evidence: merchantRefundEvidence,
    captureKey: z.string().regex(/^[a-f0-9]{64}$/).optional() }),
  output: z.object({ observationId: z.uuid(), captureId: z.uuid(), bindingVerified: z.boolean() }), auditInputFields: ["source", "requestId", "inspectionId"],
  handler: async ({ source, requestId, inspectionId, evidence, captureKey }, ctx) => {
    const paymentId = source.kind === "payment" ? source.paymentId : null, subscriptionChargeReceiptId = source.kind === "subscription" ? source.receiptId : null;
    const [original] = requestId ? await ctx.tx.select().from(merchantRefundRequests).where(eq(merchantRefundRequests.id, requestId)) : [];
    if(inspectionId)await ctx.tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`merchant-return-read:${inspectionId}`}))`);
    const [inspection] = inspectionId ? await ctx.tx.select().from(merchantCashReturnInspections).where(eq(merchantCashReturnInspections.id, inspectionId)) : [];
    const originalOwner = original && original.paymentId === paymentId && original.subscriptionChargeReceiptId === subscriptionChargeReceiptId;
    const[stoppedInspection]=inspectionId?await ctx.tx.select().from(merchantCashReturnInspectionStops).where(eq(merchantCashReturnInspectionStops.inspectionId,inspectionId)).limit(1):[];
    // Actual authenticated refund ingress is retained even after a late holder
    // callback. Its claimed original inspection stays explicit; a stopped
    // caller can never append to that inspection's authenticated evidence.
    const inspectionBound = inspection && !stoppedInspection && inspection.paymentId === paymentId && inspection.subscriptionChargeReceiptId === subscriptionChargeReceiptId;
    if (paymentId) {
      const [payment] = await ctx.tx.select().from(payments).where(eq(payments.id, paymentId));
      if (!payment || payment.provider !== "stripe" || !originalOwner && !inspectionBound && !(await routingForPayment(ctx, paymentId)).providerPlatformAccountId) throw new ServiceError("conflict", "Restore the actual original merchant payment before associating refund evidence.");
    } else {
      const [receipt] = await ctx.tx.select({ id: subscriptionProviderChargeReceipts.id }).from(subscriptionProviderChargeReceipts).where(eq(subscriptionProviderChargeReceipts.id, subscriptionChargeReceiptId!));
      if (!receipt) throw new ServiceError("conflict", "Restore the original subscription cash receipt before associating refund evidence.");
    }
    // Missing intent, nullable linkage/status and contradictory routing never
    // roll back actual authenticated refund money. They remain recovery debt.
    const [resource] = originalOwner && original.providerPlatformAccountId === evidence.providerPlatformAccountId
      && original.chargeAccountId === (evidence.providerAccountId ?? null) ? await ctx.tx.select({ id: merchantRefundResourceBindings.id })
        .from(merchantRefundResourceBindings).where(and(eq(merchantRefundResourceBindings.requestId, original.id), eq(merchantRefundResourceBindings.providerRef, evidence.providerRef))).limit(1) : [];
    // A list/metadata candidate retains a claimed source, not a proven request
    // owner. The independent original ACK/request-log binding owns that FK.
    const bound = resource && originalOwner ? original : undefined;
    const bindingVerified = Boolean(bound && evidence.bindingVerified && bound.providerPlatformAccountId === evidence.providerPlatformAccountId
      && bound.chargeAccountId === (evidence.providerAccountId ?? null) && bound.providerApiVersion === evidence.providerApiVersion
      && bound.originalPaymentRef === evidence.paymentProviderRef && bound.amountMinor === evidence.amountMinor && bound.currency === evidence.currency);
    const values = { inspectionId: inspectionBound ? inspection.id : null, claimedInspectionId: inspectionId ?? null, paymentId, subscriptionChargeReceiptId, requestId: bound?.id ?? null, claimedRequestId: requestId ?? null,
      providerPlatformAccountId: evidence.providerPlatformAccountId, chargeAccountId: evidence.providerAccountId ?? null, providerApiVersion: evidence.providerApiVersion,
      providerRef: evidence.providerRef, paymentProviderRef: evidence.paymentProviderRef, providerChargeRef: evidence.providerChargeRef ?? null,
      amountMinor: evidence.amountMinor, currency: evidence.currency, status: evidence.status, failureCode: evidence.failureCode ?? null,
      failureReason: evidence.failureReason ?? null, failureBalanceTransactionRef: evidence.failureBalanceTransactionRef ?? null,
      transferReversalRef: evidence.transferReversalRef ?? null, sourceTransferReversalRef: evidence.sourceTransferReversalRef ?? null,
      bindingVerified, evidenceDigest: merchantTaxDigest({ paymentId, subscriptionChargeReceiptId, inspectionId: inspectionBound ? inspection.id : null, claimedInspectionId: inspectionId ?? null, claimedRequestId: requestId ?? null, ...evidence, bindingVerified }) };
    await allowOriginalMerchantRefundWrites(ctx.tx);
    await ctx.tx.insert(merchantRefundObservations).values(values).onConflictDoNothing();
    const [saved] = await ctx.tx.select().from(merchantRefundObservations).where(eq(merchantRefundObservations.evidenceDigest, values.evidenceDigest));
    if (!saved || Object.entries(values).some(([key, value]) => saved[key as keyof typeof saved] !== value)) throw new ServiceError("conflict", "The actual original refund evidence needs recovery; earlier observations were preserved.");
    // A new authenticated occurrence can repeat an earlier semantic state.
    // Preserve that occurrence so a later requires_action cannot disappear
    // behind an old deduplicated row after a current-read success receipt.
    const key = captureKey ?? merchantTaxDigest({ captureId: randomUUID() });
    await ctx.tx.insert(merchantRefundObservationCaptures).values({ observationId: saved.id, captureKey: key }).onConflictDoNothing();
    const [existingCapture] = await ctx.tx.select().from(merchantRefundObservationCaptures).where(eq(merchantRefundObservationCaptures.captureKey, key));
    let capture = existingCapture;
    if (capture && capture.observationId !== saved.id) {
      // Conflicting actual evidence still commits; it must not replace the
      // first capture or roll back this new primary observation.
      const conflictingKey = merchantTaxDigest({ claimedCaptureKey: key, actualEvidenceDigest: saved.evidenceDigest });
      await ctx.tx.insert(merchantRefundObservationCaptures).values({ observationId: saved.id, captureKey: conflictingKey }).onConflictDoNothing();
      [capture] = await ctx.tx.select().from(merchantRefundObservationCaptures).where(eq(merchantRefundObservationCaptures.captureKey, conflictingKey));
    }
    if (!capture || capture.observationId !== saved.id) throw new ServiceError("conflict", "Restore the exact authenticated refund capture; earlier financial observations were preserved.");
    queueOriginalMerchantRefundRepair(ctx, { kind: "refund_observation", id: saved.id });
    queueOriginalMerchantRefundRepair(ctx, { kind: "refund_capture", id: capture.id });
    if (bound) {
      const [ownRead] = await ctx.tx.execute<{ own: boolean }>(sql`select exists(select 1 from merchant_refund_state_reads r
        where r.request_id=${bound.id}::uuid and encode(sha256(convert_to('refund-state-read:'||r.id::text,'UTF8')),'hex')=${capture.captureKey}) as own`);
      // Feedback and inspection captures need an actual original-resource job.
      // Its own exact-read capture does not recursively schedule another GET.
      if (ownRead?.own !== true) await enqueueJob(ctx.tx, "invoicing.reconcileOriginalRefundCurrentState", { requestId: bound.id },
        { idempotencyKey: `original-refund-current:${capture.id}`, startAfter: 5 });
    }
    ctx.setSubject(paymentId ? "payment" : "subscription_provider_charge", paymentId ?? subscriptionChargeReceiptId!);
    return { observationId: saved.id, captureId: capture.id, bindingVerified: saved.bindingVerified };
  },
});
// Private registration is present; qualification still requires the complete dispatch, application guard and recovery path.

export default [recordMerchantRefundObservation];
