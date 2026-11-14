// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C9.33/C12.38: paid effects run AFTER the real money transaction commits.
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { defineService, ServiceError } from "@/core/service";
import { lockContactIdentityForRead } from "@/core/contacts/identity-lock";
import { moduleSettings } from "@/core/settings/schema";
import { advanceSubscriptionPeriod } from "@/core/entitlements/period-service";
import { invoices } from "@/modules/invoicing/schema";
import { subscriptionControlledCollections, subscriptionControlledQuotes } from "./controlled-provider-collection-schema";
import { subscriptionControlledResources } from "./controlled-provider-schema";
import { subscriptions, subscriptionEvents } from "./schema";
import { originalMerchantTerms } from "./merchant-terms-read";
import { commercialBillingStart } from "./commercial-amendment-calendar";
import { periodEnd } from "./calendar";
import { subscriptionControlledPaidPeriodReceipts } from "./controlled-provider-paid-period-schema";
import { CONTROLLED_PAID_PERIOD_PROTOCOL, signControlledPaidPeriod, verifiedControlledPaidPeriod } from "./controlled-provider-paid-period-proof";
import { controlledCollectionState } from "./controlled-provider-collection-state";
import { controlledPaidParentSnapshot, lockControlledPaidSources, readControlledPaidBank, refuseControlledPaid } from "./controlled-provider-paid-bank";

const output = z.object({ handled: z.boolean(), state: z.enum(["unrelated", "awaiting_payment", "awaiting_start", "review_required", "applied", "already_applied"]), financialReviewPending: z.boolean().nullable() }).strict();
/** Real existing invoice and exact accepted target only; no public proof or
 * marker can request a calendar change. SQL must independently prove the
 * alternate-writer boundary before any new effect becomes available. */
export const completePaidControlledPeriod = defineService({
  name: "subscriptions.completePaidControlledPeriod", summary: "Advance only the original exact fully paid controlled period from current real bank/receipt ownership, in a separate transaction from money.",
  kind: "mutation", permission: "system", external: false, writeClass: "money", auditInputFields: ["invoiceId"],
  input: z.object({ invoiceId: z.uuid() }).strict(), output,
  handler: async ({ invoiceId }, ctx) => {
    const selected = await ctx.tx.select({ collection: subscriptionControlledCollections, quote: subscriptionControlledQuotes }).from(subscriptionControlledCollections)
      .innerJoin(subscriptionControlledQuotes, eq(subscriptionControlledQuotes.id, subscriptionControlledCollections.quoteId))
      .where(eq(subscriptionControlledCollections.invoiceId, invoiceId)).limit(2);
    if (!selected.length) return { handled: false, state: "unrelated" as const, financialReviewPending: null };
    const target = selected[0]; if (!target || selected.length !== 1) refuseControlledPaid();
    if (target.collection.kind !== "period") return { handled: false, state: "unrelated" as const, financialReviewPending: null };
    await lockContactIdentityForRead(ctx.tx);
    await ctx.tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`controlled-provider:${target.quote.resourceId}`}))`);
    const [resource] = await ctx.tx.select().from(subscriptionControlledResources).where(eq(subscriptionControlledResources.id, target.quote.resourceId)).limit(1).for("update");
    const [parent] = resource ? await ctx.tx.select().from(subscriptions).where(eq(subscriptions.id, resource.subscriptionId)).limit(1).for("update") : [];
    if (!resource || !parent) refuseControlledPaid();
    const eventPrefix = `controlled-period:${target.collection.id}:terms:${target.collection.termsId}:quote:${target.collection.acceptedQuoteDigest}:`;
    const existing = await ctx.tx.select().from(subscriptionEvents).where(and(eq(subscriptionEvents.subscriptionId, parent.id), eq(subscriptionEvents.invoiceId, invoiceId), eq(subscriptionEvents.kind, "renewed"))).limit(2);
    const [priorEffect] = await ctx.tx.select().from(subscriptionControlledPaidPeriodReceipts).where(eq(subscriptionControlledPaidPeriodReceipts.collectionId, target.collection.id)).limit(1);
    if (existing.length || priorEffect) {
      if (!priorEffect || !verifiedControlledPaidPeriod(priorEffect) || priorEffect.invoiceId !== invoiceId || priorEffect.resourceId !== resource.id
        || existing.length !== 1 || existing[0]?.id !== priorEffect.renewalEventId || !existing[0].detail?.startsWith(eventPrefix)
        || parent.currentPeriodStart < priorEffect.periodStart || parent.currentPeriodEnd < priorEffect.periodEnd) refuseControlledPaid();
      // Historical no-op creates no access and declares no current bank safety.
      return { handled: true, state: "already_applied" as const, financialReviewPending: null };
    }
    const state = await controlledCollectionState(ctx.tx, target.collection.id);
    if (state.review.kind !== "period" || state.collection.kind !== "period" || state.parent.id !== parent.id) refuseControlledPaid();
    if (state.canonical.invoice.status !== "paid") return { handled: true, state: "awaiting_payment" as const, financialReviewPending: null };
    const start = new Date(state.review.calendar.proposedPeriodStart), end = new Date(state.review.calendar.proposedPeriodEnd), now = new Date();
    if (now < start) return { handled: true, state: "awaiting_start" as const, financialReviewPending: null };
    const [enabled] = await ctx.tx.select().from(moduleSettings).where(eq(moduleSettings.module, "subscriptions")).limit(1);
    if (!enabled?.enabled || now >= end || parent.signupPending || parent.cancelledAt || parent.cancelAtPeriodEnd || !["active", "trialing", "past_due"].includes(parent.status)
      || parent.billingMode !== "provider" || parent.merchantScopeVersion !== 1 || parent.provider !== "stripe"
      || parent.currentPeriodStart.toISOString() !== state.review.originalPeriodStart || parent.currentPeriodEnd.toISOString() !== state.review.originalPeriodEnd
      || (parent.trialEndsAt?.toISOString() ?? null) !== state.review.originalTrialEndsAt) return { handled: true, state: "review_required" as const, financialReviewPending: true };
    const calendar = await commercialBillingStart(ctx, parent), terms = await originalMerchantTerms(ctx, parent, start);
    if (!calendar.ready || calendar.start.getTime() !== start.getTime() || !terms || terms.id !== state.collection.termsId
      || periodEnd(start, terms.snapshot.interval, terms.snapshot.intervalCount).getTime() !== end.getTime()
      || parent.status === "trialing" && (!parent.trialEndsAt || start < parent.trialEndsAt)
      || state.canonical.invoice.sourceId !== `${parent.id}:${start.toISOString()}`) refuseControlledPaid();
    const pending = calendar.pending;
    if (parent.pendingPlanId && (!pending || pending.amendment.state !== "activated" || pending.terms.id !== terms.id || pending.amendment.planId !== parent.pendingPlanId)) refuseControlledPaid();
    const planId = pending?.amendment.planId ?? parent.planId;
    const [installed] = await ctx.tx.execute<{ ready: boolean }>(sql`select freeholder_controlled_paid_period_ready() as ready`);
    if (installed?.ready !== true) throw new ServiceError("conflict", "Install and qualify the genuine controlled paid-period alternate-writer guard before applying access.");
    await lockControlledPaidSources(ctx, target.collection.id);
    // Genuine real events are born first, then INCLUDED in the fresh complete
    // parent proof. No arbitrary event/child subtraction or historical digest
    // waiver is used to certify this new independent effect transaction.
    await readControlledPaidBank(ctx, target.collection.id);
    const [renewed] = await ctx.tx.insert(subscriptionEvents).values({ subscriptionId: parent.id, kind: "renewed", invoiceId, at: now, detail: `${eventPrefix}actual:${now.toISOString()}` }).returning({ id: subscriptionEvents.id });
    const changed = planId !== parent.planId ? (await ctx.tx.insert(subscriptionEvents).values({ subscriptionId: parent.id, kind: "plan_changed", fromPlanId: parent.planId, toPlanId: planId, invoiceId, at: now, detail: `controlled-period:${target.collection.id}:accepted-amendment:${terms.id}` }).returning({ id: subscriptionEvents.id }))[0] : null;
    if (!renewed || planId !== parent.planId && !changed) refuseControlledPaid();
    const proof = await readControlledPaidBank(ctx, target.collection.id);
    const [original] = await ctx.tx.execute<{ transaction_id: string; fingerprint: string; fields: Record<string, unknown> }>(sql`select txid_current()::text as transaction_id,encode(sha256(convert_to(to_jsonb(s)::text,'UTF8')),'hex') as fingerprint,
      jsonb_build_object('plan_id',s.plan_id,'product_variant_id',s.product_variant_id,'pending_plan_id',s.pending_plan_id,'status',s.status,
       'current_period_start',s.current_period_start,'current_period_end',s.current_period_end,'trial_ends_at',s.trial_ends_at,'dunning_started_at',s.dunning_started_at,
       'dunning_invoice_id',s.dunning_invoice_id,'dunning_attempt',s.dunning_attempt,'dunning_next_at',s.dunning_next_at,'updated_at',s.updated_at) as fields from subscriptions s where s.id=${parent.id}::uuid`);
    const current = await controlledPaidParentSnapshot(ctx, target.collection.id);
    if (!original) refuseControlledPaid();
    const stamp = z.object({ transaction_id: z.string().regex(/^[0-9]+$/), fingerprint: z.string().regex(/^[a-f0-9]{64}$/), fields: z.record(z.string(), z.unknown()) }).strict().parse(original);
    if (current.physicalRowCount >= 5000 || current.revision !== proof.parentRevision || current.entries.find(row => row.table === "subscriptions" && row.id === parent.id)?.fingerprint !== stamp.fingerprint) refuseControlledPaid();
    const unsigned = { id: randomUUID(), protocol: CONTROLLED_PAID_PERIOD_PROTOCOL, admissionTransactionId: stamp.transaction_id,
      collectionId: target.collection.id, resourceId: resource.id, subscriptionId: parent.id, invoiceId, termsId: terms.id,
      renewalEventId: renewed.id, planEventId: changed?.id ?? null, planId, productVariantId: terms.snapshot.productVariantId,
      acceptedQuoteDigest: target.collection.acceptedQuoteDigest, canonicalTargetDigest: state.canonical.digest,
      parentRevision: current.revision, beforeParentFingerprint: stamp.fingerprint, beforeEntries: current.entries, beforeParentFields: stamp.fields,
      bankRevisions: proof.latestBank, periodStart: start, periodEnd: end, effectAt: now, financialReviewPending: proof.financialReviewPending, createdAt: now };
    const [stillInstalled] = await ctx.tx.execute<{ ready: boolean }>(sql`select freeholder_controlled_paid_period_ready() as ready`);
    if (stillInstalled?.ready !== true) refuseControlledPaid();
    await ctx.tx.insert(subscriptionControlledPaidPeriodReceipts).values({ ...unsigned, ...signControlledPaidPeriod(unsigned) });
    // Original accepted service calendar remains intact. Actual grants begin
    // NOW; no earlier customer access is manufactured by a paid invoice.
    await ctx.tx.update(subscriptions).set({ planId, productVariantId: terms.snapshot.productVariantId, pendingPlanId: null,
      status: "active", currentPeriodStart: start, currentPeriodEnd: end, trialEndsAt: null,
      dunningStartedAt: null, dunningInvoiceId: null, dunningAttempt: 0, dunningNextAt: null, updatedAt: now }).where(eq(subscriptions.id, parent.id));
    await ctx.callAsSystem(advanceSubscriptionPeriod, { subscriptionId: parent.id, contactId: parent.contactId, planId, planName: terms.snapshot.name, startsAt: now, endsAt: end });
    ctx.queueEvent("subscription.renewed", { subscriptionId: parent.id, invoiceId }); ctx.setSubject("subscription", parent.id);
    return { handled: true, state: "applied" as const, financialReviewPending: proof.financialReviewPending };
  },
});

/** Retry only real accepted paid targets, each in its own real effect TX. */
export const pendingPaidControlledPeriods = defineService({
  name: "subscriptions.pendingPaidControlledPeriods", summary: "Find actual paid original-period targets awaiting their independent effect transaction.",
  kind: "query", permission: "system", external: false, input: z.object({}).strict(), output: z.array(z.uuid()).max(200),
  handler: async (_input, ctx) => {
    const rows = await ctx.tx.select({ invoiceId: invoices.id }).from(subscriptionControlledCollections)
      .innerJoin(subscriptionControlledQuotes, eq(subscriptionControlledQuotes.id, subscriptionControlledCollections.quoteId))
      .innerJoin(invoices, eq(invoices.id, subscriptionControlledCollections.invoiceId))
      .leftJoin(subscriptionControlledPaidPeriodReceipts, eq(subscriptionControlledPaidPeriodReceipts.collectionId, subscriptionControlledCollections.id))
      .where(and(eq(subscriptionControlledCollections.kind, "period"), eq(invoices.status, "paid"), sql`${subscriptionControlledPaidPeriodReceipts.id} is null`,
        sql`(${subscriptionControlledQuotes.review}->'calendar'->>'proposedPeriodEnd')::timestamptz>clock_timestamp()`,
        sql`(${subscriptionControlledQuotes.review}->'calendar'->>'proposedPeriodStart')::timestamptz<=clock_timestamp()`))
      .orderBy(subscriptionControlledCollections.id).limit(200);
    return [...new Set(rows.map(row => row.invoiceId))];
  },
});
