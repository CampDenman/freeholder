// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: actual next-period invoice lineage precedes canonical cash application.
import { randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { lockContactIdentityForRead } from "@/core/contacts/identity-lock";
import { defineService, ServiceError, type ServiceContext } from "@/core/service";
import { merchantTaxDigest } from "@/modules/invoicing/merchant-tax-store";
import { providerPhase, providerPhaseInventory, assertPhaseHorizon } from "./provider-phase-contract";
import { providerPeriodInvoiceEvidence, providerInvoiceMatchesPhase } from "./provider-period-contract";
import { subscriptionProviderInvoiceObservations, subscriptionProviderInvoiceLines } from "./provider-period-schema";
import { subscriptionProviderScheduleOperations, subscriptionProviderScheduleResources } from "./provider-schedule-schema";
import { subscriptionCommercialTerms, subscriptionMerchantScopes, subscriptionProviderChargeReceipts, subscriptions } from "./schema";
import { originalMerchantTerms } from "./merchant-terms-read";
import { retainGenerationInvoiceLink } from "./provider-generations";
import { enqueueMerchantScheduleErasureRepair } from "./provider-schedule-erasure";

export async function admittedProviderPeriod(ctx: ServiceContext, parent: typeof subscriptions.$inferSelect, termsId: string, start: Date, end: Date) {
  const operations = await ctx.tx.select().from(subscriptionProviderScheduleOperations).where(eq(subscriptionProviderScheduleOperations.subscriptionId, parent.id)).orderBy(subscriptionProviderScheduleOperations.operationRevision).limit(5001);
  if (operations.length > 5000) throw new ServiceError("conflict", "Restore the bounded original admitted phase history before billing a period.");
  const found = [];
  for (const operation of operations) {
    if (operation.originalRequest.resourceKind !== "phase_schedule" || merchantTaxDigest(operation.originalRequest) !== operation.requestDigest) continue;
    const phases = z.array(providerPhase).min(1).max(10).safeParse(operation.originalRequest.phases);
    if (!phases.success) throw new ServiceError("conflict", "Restore the exact admitted original phase quotations.");
    assertPhaseHorizon(phases.data);
    found.push(...phases.data.filter(phase => phase.termsId === termsId && phase.start === start.toISOString() && phase.end === end.toISOString()));
  }
  const digests = new Set(found.map(phase => phase.phaseDigest));
  if (digests.size > 1) throw new ServiceError("conflict", "Multiple original prices claim this exact period; reconcile them before applying money.");
  return found[0] ?? null;
}
export const retainMerchantProviderInvoice = defineService({
  name: "subscriptions.retainProviderInvoice", summary: "Retain complete actual provider invoice/price lines independently of canonical balance application.",
  kind: "mutation", permission: "system", external: false, input: z.object({ subscriptionId: z.uuid(), evidence: providerPeriodInvoiceEvidence }),
  output: z.object({ observationId: z.uuid(), verified: z.boolean() }), auditInputFields: ["subscriptionId"],
  handler: async ({ subscriptionId, evidence }, ctx) => {
    await lockContactIdentityForRead(ctx.tx);
    const [parent] = await ctx.tx.select().from(subscriptions).where(eq(subscriptions.id, subscriptionId)).limit(1).for("update");
    const [scope] = await ctx.tx.select().from(subscriptionMerchantScopes).where(eq(subscriptionMerchantScopes.subscriptionId, subscriptionId)).limit(1);
    const [resource] = await ctx.tx.select().from(subscriptionProviderScheduleResources).where(eq(subscriptionProviderScheduleResources.subscriptionId, subscriptionId)).limit(1).for("update");
    if (!parent || !scope || !resource || parent.merchantScopeVersion !== 1) throw new ServiceError("conflict", "Restore the original agreement before retaining its actual invoice.");
    const evidenceDigest = merchantTaxDigest(evidence);
    const [replay] = await ctx.tx.select().from(subscriptionProviderInvoiceObservations).where(and(eq(subscriptionProviderInvoiceObservations.subscriptionId, subscriptionId), eq(subscriptionProviderInvoiceObservations.evidenceDigest, evidenceDigest))).limit(1);
    if (replay) return { observationId: replay.id, verified: replay.verified };
    const [operation] = evidence.providerOperationId ? await ctx.tx.select().from(subscriptionProviderScheduleOperations).where(eq(subscriptionProviderScheduleOperations.id, evidence.providerOperationId)).limit(1) : [];
    const phases = z.array(providerPhase).min(1).max(10).safeParse(operation?.originalRequest.phases);
    const phase = phases.success ? phases.data.find(phase => phase.phaseDigest === evidence.phaseDigest && phase.termsId === evidence.termsId) : undefined;
    if (phases.success) assertPhaseHorizon(phases.data);
    const inventory = providerPhaseInventory.safeParse(operation?.providerObservation.phaseInventory), observedPrice = inventory.success && inventory.data.operationId === operation?.id && inventory.data.requestDigest === operation?.requestDigest
      ? inventory.data.phases.find(candidate => candidate.phaseDigest === phase?.phaseDigest)?.providerPriceRef : undefined;
    const [terms] = phase ? await ctx.tx.select().from(subscriptionCommercialTerms).where(eq(subscriptionCommercialTerms.id, phase.termsId)).limit(1) : [];
    const namespace = z.object({ providerProductRef: z.string().regex(/^prod_[A-Za-z0-9]+$/), providerCustomerRef: z.string().regex(/^cus_[A-Za-z0-9]+$/) }).safeParse(operation?.originalRequest);
    const verified = !!operation && operation.subscriptionId === subscriptionId && operation.originalRequest.resourceKind === "phase_schedule" && merchantTaxDigest(operation.originalRequest) === operation.requestDigest
      && operation.providerApiVersion === scope.providerScheduleApiVersion && operation.originalRequest.providerPlatformAccountId === scope.providerPlatformAccountId && (operation.originalRequest.providerAccountId ?? null) === scope.chargeAccountId
      && !!phase && !!terms && terms.subscriptionId === subscriptionId && terms.profileId === phase.profileId && terms.profileVersion === phase.profileVersion && namespace.success
      && providerInvoiceMatchesPhase(evidence, { ...phase, ...namespace.data, operationId: operation.id, ...(observedPrice ? { providerPriceRef: observedPrice } : {}) });
    const observationId = randomUUID(), revision = resource.evidenceRevision + 1;
    await ctx.tx.execute(sql`select set_config('freeholder.subscription_period_v1','1',true),set_config('freeholder.subscription_schedule_v1','1',true)`);
    await ctx.tx.update(subscriptionProviderScheduleResources).set({ evidenceRevision: revision, state: "unknown", recoveryPending: true, stoppedProof: null, updatedAt: new Date() }).where(eq(subscriptionProviderScheduleResources.subscriptionId, subscriptionId));
    const { lines, complete, ...material } = evidence; void complete;
    await ctx.tx.insert(subscriptionProviderInvoiceObservations).values({ id: observationId, subscriptionId, evidenceRevision: revision, evidenceDigest, ...material, lineCount: lines.length, verified });
    if (lines.length) await ctx.tx.insert(subscriptionProviderInvoiceLines).values(lines.map((line, position) => ({ ...line, id: randomUUID(), observationId, position,
      periodStart: line.periodStart ? new Date(line.periodStart) : null, periodEnd: line.periodEnd ? new Date(line.periodEnd) : null })));
    if (verified && operation && evidence.providerCustomerRef) await retainGenerationInvoiceLink(ctx, operation, { providerSubscriptionRef: evidence.providerSubscriptionRef, providerCustomerRef: evidence.providerCustomerRef });
    await enqueueMerchantScheduleErasureRepair(ctx.tx, { subscriptionId, evidenceDigest });
    ctx.setSubject("subscription", subscriptionId); return { observationId, verified };
  },
});
export const proveMerchantProviderPeriod = defineService({
  name: "subscriptions.proveProviderPeriod", summary: "Bind this actual original scheduled receipt to its latest complete admitted invoice/phase lineage.",
  kind: "query", permission: "system", external: false,
  input: z.object({ observationId: z.uuid(), receiptId: z.uuid().optional(), subscriptionId: z.uuid(), periodStart: z.iso.datetime(), periodEnd: z.iso.datetime() }),
  output: z.object({ observationId: z.uuid(), providerInvoiceRef: z.string(), phase: providerPhase }),
  handler: async (input, ctx) => {
    const [observation] = await ctx.tx.select().from(subscriptionProviderInvoiceObservations).where(eq(subscriptionProviderInvoiceObservations.id, input.observationId)).limit(1);
    const [parent] = await ctx.tx.select().from(subscriptions).where(eq(subscriptions.id, input.subscriptionId)).limit(1).for("share");
    if (!observation || !parent || observation.subscriptionId !== parent.id || !observation.verified || !observation.providerOperationId) throw new ServiceError("conflict", "Retain and verify this original provider invoice's complete price and line history before applying money.");
    const [latest] = await ctx.tx.select({ id: subscriptionProviderInvoiceObservations.id }).from(subscriptionProviderInvoiceObservations).where(and(eq(subscriptionProviderInvoiceObservations.subscriptionId, parent.id), eq(subscriptionProviderInvoiceObservations.providerInvoiceRef, observation.providerInvoiceRef))).orderBy(desc(subscriptionProviderInvoiceObservations.evidenceRevision)).limit(1);
    const [operation] = await ctx.tx.select().from(subscriptionProviderScheduleOperations).where(eq(subscriptionProviderScheduleOperations.id, observation.providerOperationId)).limit(1);
    const phases = z.array(providerPhase).min(1).max(10).safeParse(operation?.originalRequest.phases), phase = phases.success ? phases.data.find(value => value.phaseDigest === observation.phaseDigest) : undefined;
    const lines = await ctx.tx.select().from(subscriptionProviderInvoiceLines).where(eq(subscriptionProviderInvoiceLines.observationId, observation.id)).orderBy(subscriptionProviderInvoiceLines.position).limit(2001);
    const { id: ignoredId, subscriptionId: ignoredSubscription, evidenceRevision: ignoredRevision, evidenceDigest: ignoredDigest, lineCount, verified: ignoredVerified, createdAt: ignoredCreated, ...material } = observation;
    void ignoredId; void ignoredSubscription; void ignoredRevision; void ignoredDigest; void ignoredVerified; void ignoredCreated;
    const actual = providerPeriodInvoiceEvidence.parse({ ...material, complete: true, lines: lines.map(({ id, observationId, position, periodStart, periodEnd, ...line }) => {
      void id; void observationId; void position; return { ...line, periodStart: periodStart?.toISOString() ?? null, periodEnd: periodEnd?.toISOString() ?? null };
    }) });
    const namespace = z.object({ providerProductRef: z.string().regex(/^prod_[A-Za-z0-9]+$/), providerCustomerRef: z.string().regex(/^cus_[A-Za-z0-9]+$/) }).safeParse(operation?.originalRequest);
    const inventory = providerPhaseInventory.safeParse(operation?.providerObservation.phaseInventory);
    const expectedPrice = inventory.success && inventory.data.operationId === operation?.id && inventory.data.requestDigest === operation?.requestDigest ? inventory.data.phases.find(value => value.phaseDigest === phase?.phaseDigest)?.providerPriceRef : undefined;
    if (!operation || merchantTaxDigest(operation.originalRequest) !== operation.requestDigest || !phase || !namespace.success || lines.length !== lineCount
      || !providerInvoiceMatchesPhase(actual, { ...phase, ...namespace.data, operationId: operation.id, ...(expectedPrice ? { providerPriceRef: expectedPrice } : {}) })) throw new ServiceError("conflict", "The immutable normalized invoice lines no longer prove this actual admitted phase.");
    const governing = await originalMerchantTerms(ctx, parent, new Date(input.periodStart));
    if (latest?.id !== observation.id || !phase || phase.termsId !== governing?.id || phase.start !== input.periodStart || phase.end !== input.periodEnd) throw new ServiceError("conflict", "The actual provider period is stale, unaccepted or belongs to different frozen dates.");
    if (input.receiptId) {
      const [receipt] = await ctx.tx.select().from(subscriptionProviderChargeReceipts).where(eq(subscriptionProviderChargeReceipts.id, input.receiptId)).limit(1);
      if (!receipt || receipt.subscriptionId !== parent.id || receipt.providerInvoiceRef !== observation.providerInvoiceRef || receipt.providerSubscriptionRef !== observation.providerSubscriptionRef
        || receipt.currency !== phase.currency || receipt.amountMinor <= 0 || receipt.amountMinor > phase.totalMinor) throw new ServiceError("conflict", "This original cash receipt does not belong to the admitted invoice and phase.");
    } else if (phase.totalMinor !== 0 || observation.totalMinor !== 0 || observation.paidMinor !== 0) throw new ServiceError("conflict", "A nonzero original invoice needs its actual committed cash receipt.");
    return { observationId: observation.id, providerInvoiceRef: observation.providerInvoiceRef, phase };
  },
});
export default [retainMerchantProviderInvoice, proveMerchantProviderPeriod];
/** Canonical net/setup lines, tax owner/date and the existing shared fee receipt
 * must reproduce the admitted period. No new fee or settlement calculator. */
export async function assertCanonicalProviderPeriod(ctx: ServiceContext, invoiceId: string, phase: z.infer<typeof providerPhase>) {
  const { invoices, invoiceLines } = await import("@/modules/invoicing/schema");
  const { invoiceMerchantTaxQuotes } = await import("@/modules/invoicing/merchant-tax-schema");
  const { getInvoiceMarketPolicy } = await import("@/modules/invoicing/market-policy");
  const [invoice] = await ctx.tx.select().from(invoices).where(eq(invoices.id, invoiceId)).limit(1);
  const lines = await ctx.tx.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, invoiceId)).orderBy(invoiceLines.position).limit(3);
  const taxes = await ctx.tx.select().from(invoiceMerchantTaxQuotes).where(eq(invoiceMerchantTaxQuotes.invoiceId, invoiceId)).limit(2);
  const fee = await ctx.callAsSystem(getInvoiceMarketPolicy, { invoiceId });
  const expected = [{ component: "period", amount: phase.periodAmountMinor }, ...(phase.setupFeeMinor > 0 ? [{ component: "setup", amount: phase.setupFeeMinor }] : [])];
  if (!invoice || invoice.status === "void" || invoice.currency !== phase.currency || invoice.totalMinor !== phase.totalMinor || invoice.taxMinor !== phase.taxMinor
    || invoice.shippingMinor !== 0 || invoice.discountMinor !== 0 || !fee || fee.feeMinor !== phase.applicationFeeMinor || fee.siteFeeBps !== phase.siteFeeBps
    || taxes.length !== 1 || taxes[0]!.profileId !== phase.profileId || taxes[0]!.profileVersion !== phase.profileVersion || taxes[0]!.occurredAt.toISOString() !== phase.taxOccurredAt
    || taxes[0]!.taxMinor !== phase.taxMinor || taxes[0]!.shippingMinor !== 0 || taxes[0]!.shippingTaxMinor !== 0 || lines.length !== expected.length || lines.some((line, index) => {
      const proof = z.record(z.string(), z.unknown()).safeParse(line.snapshot), item = expected[index]!;
      return !proof.success || line.sourceType !== "subscription" || line.sourceId !== invoice.sourceId?.split(":")[0] || line.quantityMicros !== 1000000 || line.unitAmountMinor !== item.amount || line.discountMinor !== 0
        || proof.data.subscriptionTermsId !== phase.termsId || proof.data.subscriptionComponent !== item.component || proof.data.subscriptionPeriodStart !== phase.start || proof.data.subscriptionPeriodEnd !== phase.end
        || proof.data.subscriptionPhaseDigest !== undefined && proof.data.subscriptionPhaseDigest !== phase.phaseDigest;
    })) throw new ServiceError("conflict", "The canonical period's actual net lines, tax receipt or shared fee differs from its admitted original phase.");
}
