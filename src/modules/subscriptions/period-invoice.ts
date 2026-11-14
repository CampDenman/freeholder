// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Ordinary shared period writer; callers do not load the subscription registry.
import { eq, sql } from "drizzle-orm";
import { ServiceError, type ServiceContext } from "@/core/service";
import { contacts } from "@/core/contacts/schema";
import { listLocations } from "@/core/locations/service";
import { products, productVariants } from "@/modules/catalog/schema";
import { createDraftInvoice, issueInvoice } from "@/modules/invoicing/invoice-service";
import { invoices } from "@/modules/invoicing/schema";
import { subscriptions } from "./schema";
import { originalMerchantInvoiceShape } from "./merchant-terms-invoice";

/** Quantity is fixed-point in `invoicing`; one of something is this. */
const QUANTITY_SCALE = 1_000_000;

/**
 * The period's invoice.
 *
 * §4.6's single money object, raised through `invoicing.createDraft` with
 * `source_type = 'subscription'`; this module keeps no total of its own.
 */
export async function raiseInvoice(
  ctx: ServiceContext,
  subscription: typeof subscriptions.$inferSelect,
  options: {
    amountMinor: number;
    setupFeeMinor?: number;
    periodStart: Date;
    periodEnd: Date;
  },
): Promise<string> {
  // Serialize the original one-time obligation with the invoice it creates.
  // In particular, a no-card trial has no signup invoice to carry this fee.
  // A durable invoice witness also preserves the same first-period payload
  // after later renewals, without inferring ordering from transaction dates.
  const sourceId = `${subscription.id}:${options.periodStart.toISOString()}`;
  const [original] = await ctx.tx.select().from(subscriptions).where(eq(subscriptions.id, subscription.id)).for("update");
  if (!original) throw new ServiceError("not_found", "That subscription is not here.");
  const merchantShape = await originalMerchantInvoiceShape(ctx, original, options.periodStart, options.periodEnd);
  if (merchantShape?.existingInvoiceId) {
    await ctx.callAsSystem(issueInvoice, { id: merchantShape.existingInvoiceId });
    return merchantShape.existingInvoiceId;
  }
  if (merchantShape && merchantShape.periodAmountMinor !== options.amountMinor) throw new ServiceError("conflict", "The period amount differs from the explicitly accepted original agreement.");
  const accepted = merchantShape?.terms;
  if (accepted && !accepted.taxDestination) throw new ServiceError("conflict", "The original destination was erased; a new agreement is required before billing.");
  let setupFeeMinor = options.setupFeeMinor ?? 0;
  if (original.acceptedSetupFeeMinor !== null) {
    const [feeInvoice] = original.setupFeeInvoiceId
      ? await ctx.tx.select({ sourceType: invoices.sourceType, sourceId: invoices.sourceId, status: invoices.status })
        .from(invoices).where(eq(invoices.id, original.setupFeeInvoiceId)).for("update")
      : [];
    if (original.setupFeeInvoiceId && (!feeInvoice || feeInvoice.sourceType !== "subscription" || feeInvoice.sourceId?.split(":")[0] !== subscription.id)) {
      throw new ServiceError("conflict", "The original setup-fee invoice cannot be proved.");
    }
    if (feeInvoice?.status === "void") {
      throw new ServiceError("conflict", "Review the voided original setup-fee invoice before billing another period.");
    }
    setupFeeMinor = !original.setupFeeInvoiceId || feeInvoice?.sourceId === sourceId
      ? original.acceptedSetupFeeMinor : 0;
  }
  const [variant] = await ctx.tx
    .select({ sku: productVariants.sku, name: products.name })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
    .where(eq(productVariants.id, subscription.productVariantId));

  const [person] = await ctx.tx
    .select({ country: contacts.country })
    .from(contacts)
    .where(eq(contacts.id, subscription.contactId));
  const locations = await ctx.callAsSystem(listLocations, {});
  const origin = locations.find((each) => each.isPrimary) ?? locations[0];

  const lines = [
    {
      sourceType: "subscription" as const,
      sourceId: subscription.id,
      description: `${accepted ? accepted.snapshot.name : variant?.name ?? "Subscription"} — ${options.periodStart
        .toISOString()
        .slice(0, 10)} to ${options.periodEnd.toISOString().slice(0, 10)}`,
      quantityMicros: QUANTITY_SCALE,
      unitAmountMinor: options.amountMinor,
      ...(accepted ? { taxCategoryCode: accepted.snapshot.taxCategoryCode, requiresShipping: accepted.snapshot.requiresShipping,
        snapshot: { subscriptionTermsId: accepted.id, subscriptionPeriodStart: options.periodStart.toISOString(),
          subscriptionPeriodEnd: options.periodEnd.toISOString(), subscriptionComponent: "period", ...(merchantShape?.phase ? { subscriptionPhaseDigest: merchantShape.phase.phaseDigest } : {}) } } : {}),
    },
  ];
  // Charged once, on the first invoice only, because that is what a setup fee
  // is — a line on a renewal would be a second one.
  if (setupFeeMinor > 0) {
    lines.push({
      sourceType: "subscription" as const,
      sourceId: subscription.id,
      description: `${accepted ? accepted.snapshot.name : variant?.name ?? "Subscription"} — setup`,
      quantityMicros: QUANTITY_SCALE,
      unitAmountMinor: setupFeeMinor,
      ...(accepted ? { taxCategoryCode: accepted.snapshot.taxCategoryCode, requiresShipping: accepted.snapshot.requiresShipping,
        snapshot: { subscriptionTermsId: accepted.id, subscriptionPeriodStart: options.periodStart.toISOString(),
          subscriptionPeriodEnd: options.periodEnd.toISOString(), subscriptionComponent: "setup", ...(merchantShape?.phase ? { subscriptionPhaseDigest: merchantShape.phase.phaseDigest } : {}) } } : {}),
    });
  }

  const draft = await ctx.callAsSystem(createDraftInvoice, {
    contactId: subscription.contactId,
    currency: subscription.currency,
    sourceType: "subscription" as const,
    // The period, not just the subscription. `invoices` is uniquely indexed on
    // (source_type, source_id) — one invoice per source thing — so a recurring
    // agreement has to name which period each invoice is for, or the second
    // month collides with the first. The same compound-id convention the
    // deposit/balance pair uses.
    sourceId,
    // One invoice per subscription per period, whatever retries the sweep
    // makes. The period start is in the key because that is what makes this
    // period's invoice a different request from the last one's.
    idempotencyKey: `subscription:${subscription.id}:${options.periodStart.toISOString()}`,
    lines,
    tax:
      accepted
        ? { mode: "merchant" as const, destination: accepted.taxDestination! }
        : origin && person?.country
        ? {
            mode: "calculate" as const,
            origin: {
              country: origin.country,
              region: origin.region ?? undefined,
              postalCode: origin.postalCode ?? undefined,
              city: origin.city ?? undefined,
            },
            destination: { country: person.country },
          }
        : {
            mode: "not_applicable" as const,
            reason: "This subscription has no taxable origin and destination pair.",
          },
  });
  const issued = await ctx.callAsSystem(issueInvoice, { id: draft.invoice.id });
  if (original.acceptedSetupFeeMinor !== null && original.acceptedSetupFeeMinor > 0 && !original.setupFeeInvoiceId) {
    await ctx.tx.execute(sql`select set_config('freeholder.subscription_setup_fee_v1','1',true)`);
    await ctx.tx.update(subscriptions).set({ setupFeeInvoiceId: issued.invoice.id })
      .where(eq(subscriptions.id, subscription.id));
  }
  return issued.invoice.id;
}
