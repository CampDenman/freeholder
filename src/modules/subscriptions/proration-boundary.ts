// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C9.33/C12.38: local paidAt and provider object birth do not prove on-time money.
import { eq, sql } from "drizzle-orm";
import { ServiceError, type ServiceContext } from "@/core/service";
import { merchantTaxDigest } from "@/modules/invoicing/merchant-tax-store";
import { invoices } from "@/modules/invoicing/schema";
import { subscriptionProrations } from "./proration-schema";
import { subscriptionProrationCashConfirmations, subscriptionProrationCreditConfirmations } from "./proration-boundary-schema";
export async function requireProrationBoundarySchema(ctx: ServiceContext) {
  const [ready] = await ctx.tx.execute<{ ready: boolean }>(sql`select count(*)=8 as ready from pg_trigger where not tgisinternal and tgenabled in('O','A') and(tgrelid,tgname) in
    ((to_regclass('subscription_proration_cash_confirmations'),'subscription_proration_cash_confirmations_guard'),(to_regclass('subscription_proration_credit_confirmations'),'subscription_proration_credit_confirmations_guard'),
     (to_regclass('merchant_payment_observations'),'subscription_proration_provider_cash_confirmation'),(to_regclass('commercial_payment_attestations'),'subscription_proration_external_cash_confirmation'),
     (to_regclass('invoice_credit_applications'),'subscription_proration_credit_confirmation'),(to_regclass('subscription_prorations'),'subscription_proration_acceptance_deadline'),
     (to_regclass('subscription_prorations'),'subscription_proration_actual_paid_boundary'),(to_regclass('agreement_fee_eligibility'),'subscription_proration_fee_paid_boundary'))`);
  if (!ready?.ready) throw new ServiceError("conflict", "Install all actual principal-retention and acceptance-deadline guards before reviewing or collecting a gross target.");
}
/** Existing full canonical principal/route/caller checks remain required. This
 * additional authority proves when their positive receipts were really retained. */
export async function prorationBoundaryFunded(ctx: ServiceContext, accepted: typeof subscriptionProrations.$inferSelect) {
  await requireProrationBoundarySchema(ctx);
  if (accepted.originalTrialEndsAt) return { onTime: true, revision: merchantTaxDigest({ prorationId: accepted.id, unchargedTrial: true }) };
  const cash = await ctx.tx.select().from(subscriptionProrationCashConfirmations).where(eq(subscriptionProrationCashConfirmations.prorationId, accepted.id)).orderBy(subscriptionProrationCashConfirmations.paymentId).limit(1001);
  const credits = await ctx.tx.select().from(subscriptionProrationCreditConfirmations).where(eq(subscriptionProrationCreditConfirmations.prorationId, accepted.id)).orderBy(subscriptionProrationCreditConfirmations.applicationId).limit(1001);
  const [invoice] = accepted.debitInvoiceId ? await ctx.tx.select().from(invoices).where(eq(invoices.id, accepted.debitInvoiceId)).limit(1) : [];
  if (!invoice || cash.length + credits.length > 1000) return { onTime: false, revision: merchantTaxDigest({ prorationId: accepted.id, cash, credits, incomplete: true }) };
  const [actual] = await ctx.tx.execute<{ funded: boolean }>(sql`select freeholder_proration_boundary_funded(${accepted.id}::uuid) as funded`);
  return { onTime: actual?.funded === true, revision: merchantTaxDigest({ prorationId: accepted.id, effectiveAt: accepted.effectiveAt, invoice, cash, credits }) };
}
