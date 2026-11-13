// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: freeze new seller agreements before any setup, invoice or access.
import { createHash } from "node:crypto";
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { merchantSubscriptionUndo } from "./merchant-scope-undo";
import { getService, ServiceError, type ServiceContext, type Tx } from "@/core/service";
import { getMerchantCollectionConfiguration } from "@/modules/invoicing/merchant-collection";
import { subscriptionCommercialTerms, subscriptionMerchantScopes, subscriptionProviderChargeObservations, subscriptionProviderChargeReceipts, subscriptions } from "./schema";
import { invoices, payments } from "@/modules/invoicing/schema";
import { invoiceMerchantDependencyFingerprints } from "@/modules/invoicing/merchant-payment-dependencies";
import { merchantRefundDependencyFingerprints } from "@/modules/invoicing/merchant-refund-dependencies";
import { subscriptionCommercialResumptions } from "./commercial-resumption-schema";
import { subscriptionProviderReadWitnesses } from "./provider-read-witness";
import { subscriptionCommercialAmendments } from "./commercial-amendment-schema";
import { subscriptionProviderGenerations } from "./provider-generation-schema";
import { subscriptionProviderInvoiceObservations, subscriptionProviderInvoiceLines } from "./provider-period-schema";
import { subscriptionProviderScheduleErasures, subscriptionProviderScheduleOperations, subscriptionProviderScheduleResources } from "./provider-schedule-schema";
import { subscriptionMerchantScope, type subscriptionTaxDestination } from "./merchant-scope-contract";
import type { SubscriptionMarketPolicy } from "./market-policy";
export { merchantSubscriptionUndo } from "./merchant-scope-undo";

const profileReceipt = z.object({ profileId: z.uuid(), profileVersion: z.number().int().positive(), liability: z.enum(["platform", "seller"]) });

/** Store bounded fingerprints rather than personal destinations in merge history. */
export async function subscriptionOriginalEvidence(tx: Tx, contactIds: string[]) {
  const rows = await tx.select({ id: subscriptionMerchantScopes.subscriptionId, material: sql<string>`to_jsonb(${subscriptionMerchantScopes})::text` })
    .from(subscriptionMerchantScopes).innerJoin(subscriptions, eq(subscriptions.id, subscriptionMerchantScopes.subscriptionId))
    .where(inArray(subscriptions.contactId, contactIds)).orderBy(subscriptionMerchantScopes.subscriptionId).limit(5001);
  if (rows.length > 5000) return { evidence: [], overflow: true };
  const charges = await tx.select({ id: subscriptionProviderChargeReceipts.id, material: sql<string>`to_jsonb(${subscriptionProviderChargeReceipts})::text` })
    .from(subscriptionProviderChargeReceipts).innerJoin(subscriptions, eq(subscriptions.id, subscriptionProviderChargeReceipts.subscriptionId))
    .where(inArray(subscriptions.contactId, contactIds)).orderBy(subscriptionProviderChargeReceipts.id).limit(5001 - rows.length);
  if (rows.length + charges.length > 5000) return { evidence: [], overflow: true };
  const fingerprint = (row: { id: string; material: string }, kind: z.infer<typeof merchantSubscriptionUndo>["originalEvidence"][number]["kind"]) => ({ kind, id: row.id, fingerprint: createHash("sha256").update(row.material).digest("hex") });
  const evidence = [...rows.map(row => fingerprint(row, "scope")), ...charges.map(row => fingerprint(row, "cash"))];
  const observations = await tx.select({ id: subscriptionProviderChargeObservations.id, material: sql<string>`to_jsonb(${subscriptionProviderChargeObservations})::text` })
    .from(subscriptionProviderChargeObservations).innerJoin(subscriptions, eq(subscriptions.id, subscriptionProviderChargeObservations.subscriptionId))
    .where(inArray(subscriptions.contactId, contactIds)).orderBy(subscriptionProviderChargeObservations.id).limit(5001 - evidence.length);
  if (observations.length + evidence.length > 5000) return { evidence: [], overflow: true };
  evidence.push(...observations.map(row => fingerprint(row, "cash_observation")));
  const resources = await tx.select({ id: subscriptionProviderScheduleResources.subscriptionId, material: sql<string>`(to_jsonb(${subscriptionProviderScheduleResources})-'updated_at')::text` })
    .from(subscriptionProviderScheduleResources).innerJoin(subscriptions, eq(subscriptions.id, subscriptionProviderScheduleResources.subscriptionId))
    .where(inArray(subscriptions.contactId, contactIds)).orderBy(subscriptionProviderScheduleResources.subscriptionId).limit(5001 - evidence.length);
  if (resources.length + evidence.length > 5000) return { evidence: [], overflow: true };
  evidence.push(...resources.map(row => fingerprint(row, "schedule_resource")));
  const operations = await tx.select({ id: subscriptionProviderScheduleOperations.id, material: sql<string>`to_jsonb(${subscriptionProviderScheduleOperations})::text` })
    .from(subscriptionProviderScheduleOperations).innerJoin(subscriptions, eq(subscriptions.id, subscriptionProviderScheduleOperations.subscriptionId))
    .where(inArray(subscriptions.contactId, contactIds)).orderBy(subscriptionProviderScheduleOperations.id).limit(5001 - evidence.length);
  if (operations.length + evidence.length > 5000) return { evidence: [], overflow: true };
  evidence.push(...operations.map(row => fingerprint(row, "schedule_operation")));
  const setupFees = await tx.select({ id: subscriptions.id,
    material: sql<string>`jsonb_build_object('acceptedSetupFeeMinor',${subscriptions.acceptedSetupFeeMinor},'setupFeeInvoiceId',${subscriptions.setupFeeInvoiceId})::text` })
    .from(subscriptions).where(and(inArray(subscriptions.contactId, contactIds), isNotNull(subscriptions.acceptedSetupFeeMinor)))
    .orderBy(subscriptions.id).limit(5001 - evidence.length);
  if (setupFees.length + evidence.length > 5000) return { evidence: [], overflow: true };
  evidence.push(...setupFees.map(row => fingerprint(row, "setup_fee")));
  const terms = await tx.select({ id: subscriptionCommercialTerms.id, material: sql<string>`to_jsonb(${subscriptionCommercialTerms})::text` })
    .from(subscriptionCommercialTerms).innerJoin(subscriptions, eq(subscriptions.id, subscriptionCommercialTerms.subscriptionId))
    .where(inArray(subscriptions.contactId, contactIds)).orderBy(subscriptionCommercialTerms.id).limit(5001 - evidence.length);
  if (terms.length + evidence.length > 5000) return { evidence: [], overflow: true };
  evidence.push(...terms.map(row => fingerprint(row, "commercial_terms")));
  const commercial_amendment = await tx.select({ id: subscriptionCommercialAmendments.termsId, material: sql<string>`to_jsonb(${subscriptionCommercialAmendments})::text` })
    .from(subscriptionCommercialAmendments).innerJoin(subscriptions, eq(subscriptions.id, subscriptionCommercialAmendments.subscriptionId))
    .where(inArray(subscriptions.contactId, contactIds)).orderBy(subscriptionCommercialAmendments.termsId).limit(5001 - evidence.length);
  if (commercial_amendment.length + evidence.length > 5000) return { evidence: [], overflow: true };
  evidence.push(...commercial_amendment.map(row => fingerprint(row, "commercial_amendment")));
  const resumptions = await tx.select({ id: subscriptionCommercialResumptions.termsId, material: sql<string>`to_jsonb(${subscriptionCommercialResumptions})::text` })
    .from(subscriptionCommercialResumptions).innerJoin(subscriptions, eq(subscriptions.id, subscriptionCommercialResumptions.subscriptionId))
    .where(inArray(subscriptions.contactId, contactIds)).orderBy(subscriptionCommercialResumptions.termsId).limit(5001 - evidence.length);
  if (resumptions.length + evidence.length > 5000) return { evidence: [], overflow: true };
  evidence.push(...resumptions.map(row => fingerprint(row, "commercial_resumption")));
  const readParents = await tx.select({ id: subscriptions.id }).from(subscriptions).where(inArray(subscriptions.contactId, contactIds)).orderBy(subscriptions.id).limit(5001);
  if (readParents.length > 5000) return { evidence: [], overflow: true };
  const reads = await subscriptionProviderReadWitnesses(tx, readParents.map(row => row.id));
  if (reads.incomplete || reads.tickets.length + reads.finishes.length + reads.stops.length + evidence.length > 5000) return { evidence: [], overflow: true };
  evidence.push(...reads.tickets.map(row => ({ kind: "provider_read_ticket" as const, id: row.id, fingerprint: row.fingerprint })),
    ...reads.finishes.map(row => ({ kind: "provider_read_finish" as const, id: row.id, fingerprint: row.fingerprint })),
    ...reads.stops.map(row => ({ kind: "provider_read_stop" as const, id: row.id, fingerprint: row.fingerprint })));
  const provider_generation = await tx.select({ id: subscriptionProviderGenerations.id, material: sql<string>`to_jsonb(${subscriptionProviderGenerations})::text` })
    .from(subscriptionProviderGenerations).innerJoin(subscriptions, eq(subscriptions.id, subscriptionProviderGenerations.subscriptionId))
    .where(inArray(subscriptions.contactId, contactIds)).orderBy(subscriptionProviderGenerations.id).limit(5001 - evidence.length);
  if (provider_generation.length + evidence.length > 5000) return { evidence: [], overflow: true };
  evidence.push(...provider_generation.map(row => fingerprint(row, "provider_generation")));
  const provider_invoice = await tx.select({ id: subscriptionProviderInvoiceObservations.id, material: sql<string>`to_jsonb(${subscriptionProviderInvoiceObservations})::text` })
    .from(subscriptionProviderInvoiceObservations).innerJoin(subscriptions, eq(subscriptions.id, subscriptionProviderInvoiceObservations.subscriptionId))
    .where(inArray(subscriptions.contactId, contactIds)).orderBy(subscriptionProviderInvoiceObservations.id).limit(5001 - evidence.length);
  if (provider_invoice.length + evidence.length > 5000) return { evidence: [], overflow: true };
  evidence.push(...provider_invoice.map(row => fingerprint(row, "provider_invoice")));
  const providerInvoiceLines = await tx.select({ id: subscriptionProviderInvoiceLines.id, material: sql<string>`to_jsonb(${subscriptionProviderInvoiceLines})::text` })
    .from(subscriptionProviderInvoiceLines).innerJoin(subscriptionProviderInvoiceObservations, eq(subscriptionProviderInvoiceObservations.id, subscriptionProviderInvoiceLines.observationId))
    .innerJoin(subscriptions, eq(subscriptions.id, subscriptionProviderInvoiceObservations.subscriptionId))
    .where(inArray(subscriptions.contactId, contactIds)).orderBy(subscriptionProviderInvoiceLines.id).limit(5001 - evidence.length);
  if (providerInvoiceLines.length + evidence.length > 5000) return { evidence: [], overflow: true };
  evidence.push(...providerInvoiceLines.map(row => fingerprint(row, "provider_invoice_line")));
  const periodInvoices = await tx.select({ id: invoices.id }).from(invoices).innerJoin(subscriptions,
    sql`${invoices.sourceType}='subscription' and split_part(${invoices.sourceId},':',1)=${subscriptions.id}::text`)
    .where(inArray(subscriptions.contactId, contactIds)).orderBy(invoices.id).limit(5001);
  if (periodInvoices.length > 5000) return { evidence: [], overflow: true };
  const invoiceIds = periodInvoices.map(row => row.id), paymentIds = invoiceIds.length
    ? await tx.select({ id: payments.id }).from(payments).where(inArray(payments.invoiceId, invoiceIds)).orderBy(payments.id).limit(5001) : [];
  if (paymentIds.length > 5000) return { evidence: [], overflow: true };
  const financial = await invoiceMerchantDependencyFingerprints(tx, invoiceIds);
  if (!financial || financial.size + evidence.length > 5000) return { evidence: [], overflow: true };
  for (const [id, value] of [...financial.entries()].sort(([left], [right]) => left.localeCompare(right))) evidence.push({ kind: "invoice_financial", id, fingerprint: value });
  const returned = await merchantRefundDependencyFingerprints(tx, { paymentIds: paymentIds.map(row => row.id), subscriptionChargeReceiptIds: charges.map(row => row.id) });
  if (returned.incomplete || returned.entries.length + evidence.length > 5000) return { evidence: [], overflow: true };
  for (const entry of returned.entries) evidence.push({ kind: "refund_financial", id: entry.id,
    fingerprint: createHash("sha256").update(JSON.stringify([entry.table, entry.fingerprint])).digest("hex") });
  return { evidence, overflow: false };
}

/** Existing agreements never call this helper or consult today's configuration. */
export async function captureOriginalMerchantScope(ctx: ServiceContext, subscription: typeof subscriptions.$inferSelect, policy: SubscriptionMarketPolicy, destination: z.infer<typeof subscriptionTaxDestination> | undefined): Promise<void> {
  if (subscription.merchantScopeVersion !== 1 || policy.model !== "seller_merchant") return;
  const [existing] = await ctx.tx.select().from(subscriptionMerchantScopes).where(eq(subscriptionMerchantScopes.subscriptionId, subscription.id));
  if (existing) return;
  if (!policy.providerAccountId || !policy.sellerUserId || !destination) throw new ServiceError("validation", "Declare the buyer's tax destination before accepting this merchant agreement.");
  const configuration = await ctx.callAsSystem(getMerchantCollectionConfiguration, {});
  if (!configuration) throw new ServiceError("conflict", "Verify the original collection platform before accepting a new merchant agreement.");
  const taxService = getService("invoicing.currentMerchantTaxProfile");
  if (!taxService) throw new ServiceError("conflict", "The merchant tax profile service is unavailable; this new agreement cannot be accepted.");
  // The tax query shares the stable profile row lock with semantic revisions.
  const tax = profileReceipt.parse(await ctx.callAsSystem(taxService, { sellerUserId: policy.sellerUserId }));
  if (tax.liability !== "seller") throw new ServiceError("conflict", "This seller agreement needs its deliberately declared original seller tax policy.");
  const [erasing] = await ctx.tx.select({ id: subscriptionProviderScheduleErasures.id }).from(subscriptionProviderScheduleErasures).where(eq(subscriptionProviderScheduleErasures.profileId, tax.profileId)).limit(1);
  if (erasing) throw new ServiceError("conflict", "The original merchant's erasure prevents accepting another external billing dependency.");
  const facts = subscriptionMerchantScope.parse({ subscriptionId: subscription.id, agreementRoutingVersion: 1,
    providerScheduleApiVersion: "2026-10-28.endive",
    collectionKind: configuration.collectionKind, providerPlatformAccountId: configuration.providerPlatformAccountId,
    chargeAccountId: configuration.collectionKind === "direct" ? policy.providerAccountId : null,
    recipientAccountId: policy.providerAccountId, settlementMerchantAccountId: policy.providerAccountId,
    taxProfileId: tax.profileId, taxProfileVersion: tax.profileVersion, taxLiability: tax.liability, taxDestination: destination });
  await ctx.tx.execute(sql`select set_config('freeholder.subscription_scope_v1','1',true)`);
  await ctx.tx.insert(subscriptionMerchantScopes).values(facts);
  // The durable uncreated resource also fences a later manual→provider change.
  // A mutable billingMode can never erase the history of admitted remote work.
  await ctx.tx.execute(sql`select set_config('freeholder.subscription_schedule_v1','1',true)`);
  await ctx.tx.insert(subscriptionProviderScheduleResources).values({ subscriptionId: subscription.id });
}
