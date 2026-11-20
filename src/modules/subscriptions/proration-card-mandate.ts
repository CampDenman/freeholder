// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C9.33/C12.38: changed-price consent names the actual original stored method.
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { ServiceError, type ServiceContext } from "@/core/service";
import { enqueueJob } from "@/core/jobs";
import { jobIdempotencyKeys } from "@/core/jobs/schema";
import { merchantTaxDigest } from "@/modules/invoicing/merchant-tax-store";
import { paymentAdapter } from "@/adapters/payments";
import { paymentMethods, type invoices } from "@/modules/invoicing/schema";
import type { subscriptions } from "./schema";
import { subscriptionMethodScopeMatches } from "./merchant-scope-contract";
import { originalProrationCardMethod, prorationCardMethodDigest, PRORATION_CARD_JOB, prorationCardTask, type ProrationCardMethod } from "./proration-card-contract";
import { subscriptionProrationCardMandates, subscriptionProrationCardJobs } from "./proration-card-schema";
import type { subscriptionProrations } from "./proration-schema";
import type { MerchantChargeScope } from "@/adapters/payments";
export async function requireProrationCardSchema(ctx: ServiceContext) {
  const [ready] = await ctx.tx.execute<{ ready: boolean }>(sql`select count(*)=10 as ready from pg_trigger where not tgisinternal and tgenabled in('O','A') and(tgrelid,tgname) in
    ((to_regclass('subscription_proration_payment_protocols'),'subscription_proration_payment_protocols_guard'),(to_regclass('merchant_payment_requests'),'subscription_proration_payment_protocol_complete'),(to_regclass('subscription_proration_card_mandates'),'subscription_proration_card_mandates_guard'),(to_regclass('subscription_proration_card_attempts'),'subscription_proration_card_attempts_guard'),(to_regclass('subscription_proration_card_jobs'),'subscription_proration_card_jobs_guard'),
     (to_regclass('subscription_proration_card_reads'),'subscription_proration_card_reads_guard'),(to_regclass('subscription_proration_card_read_finishes'),'subscription_proration_card_read_finishes_guard'),
     (to_regclass('subscription_proration_card_read_stops'),'subscription_proration_card_read_stops_guard'),(to_regclass('subscription_prorations'),'subscription_proration_card_mandate_complete'),
     (to_regclass('merchant_payment_dispatches'),'subscription_proration_card_dispatch_guard'))`);
  if (!ready?.ready) throw new ServiceError("conflict", "Install the complete original stored-method mandate, physical attempt and independent read/stop guards before a card proration.");
}
export async function reviewedProrationCard(ctx: ServiceContext, parent: typeof subscriptions.$inferSelect, scope: MerchantChargeScope, cashDueMinor: number) {
  if (parent.billingMode !== "platform" || parent.status === "trialing" || cashDueMinor === 0) return null;
  await requireProrationCardSchema(ctx);
  const [method] = parent.paymentMethodId ? await ctx.tx.select().from(paymentMethods).where(eq(paymentMethods.id, parent.paymentMethodId)).limit(1).for("share") : [];
  if (!method || method.status !== "active" || method.contactId !== parent.contactId || !method.providerCustomerRef || !subscriptionMethodScopeMatches(scope, method)
    || !paymentAdapter(method.provider).capabilities().offSessionCharges) throw new ServiceError("conflict", "Review an active original-account stored method before accepting an automatic changed-price payment.");
  const authority = originalProrationCardMethod(method), methodDigest = prorationCardMethodDigest(method);
  return { authority, methodDigest, summary: { methodId: method.id, label: method.label, last4: method.last4, kind: method.kind } };
}
export async function retainProrationCardMandate(ctx: ServiceContext, accepted: typeof subscriptionProrations.$inferSelect, invoice: typeof invoices.$inferSelect,
  original: { authority: ProrationCardMethod; methodDigest: string }) {
  await requireProrationCardSchema(ctx);
  if (accepted.snapshot.billingMode !== "platform" || accepted.originalTrialEndsAt || accepted.debitInvoiceId !== invoice.id || invoice.totalMinor - invoice.creditedMinor <= 0)
    throw new ServiceError("conflict", "Only the exact accepted positive platform target can retain this original stored-method mandate.");
  await ctx.tx.execute(sql`select set_config('freeholder.proration_card_v1','1',true)`);
  await ctx.tx.insert(subscriptionProrationCardMandates).values({ prorationId: accepted.id, invoiceId: invoice.id, paymentMethodId: original.authority.id,
    method: original.authority, methodDigest: original.methodDigest, acceptedQuoteDigest: accepted.acceptedQuoteDigest });
  const originalJobId = randomUUID(), intended = { prorationId: accepted.id, originalJobId, acceptedQuoteDigest: accepted.acceptedQuoteDigest };
  const job = await enqueueJob(ctx.tx, PRORATION_CARD_JOB, intended, { id: originalJobId, idempotencyKey: `proration-card:${accepted.id}` });
  const [claim] = await ctx.tx.select().from(jobIdempotencyKeys).where(and(eq(jobIdempotencyKeys.jobId, originalJobId), eq(jobIdempotencyKeys.jobName, PRORATION_CARD_JOB))).limit(1);
  const [queued] = await ctx.tx.execute<{ data: unknown }>(sql`select data from pgboss.job where id=${originalJobId}::uuid and name=${PRORATION_CARD_JOB} limit 1`);
  const actualTask = prorationCardTask.parse(queued?.data);
  if (job.id !== originalJobId || !claim || merchantTaxDigest(actualTask) !== claim.payloadHash || merchantTaxDigest(intended) !== claim.payloadHash)
    throw new ServiceError("conflict", "Retain the actual original collection task body and enqueue claim before its accepted mandate can commit.");
  await ctx.tx.insert(subscriptionProrationCardJobs).values({ prorationId: accepted.id, jobId: originalJobId, originalTask: actualTask, claimDigest: claim.payloadHash });
}
export async function currentProrationCardMandate(ctx: ServiceContext, prorationId: string, contactId: string) {
  const [mandate] = await ctx.tx.select().from(subscriptionProrationCardMandates).where(eq(subscriptionProrationCardMandates.prorationId, prorationId)).limit(1);
  const [method] = mandate ? await ctx.tx.select().from(paymentMethods).where(eq(paymentMethods.id, mandate.paymentMethodId)).limit(1) : [];
  if (!mandate || !method || method.status !== "active" || method.contactId !== contactId || prorationCardMethodDigest(method) !== mandate.methodDigest)
    throw new ServiceError("conflict", "The original reviewed stored method changed or was revoked. Preserve the old attempt and review fresh payment authority before another charge.");
  return mandate;
}
