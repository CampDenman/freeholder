// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: seller policy is resolved through the same transaction as issue.
import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { lockContactIdentityForRead } from "@/core/contacts/identity-lock";
import {contacts} from "@/core/contacts/schema";
import { merchantIdentityErased } from "./merchant-identity-privacy";
import { ERASED_MERCHANT_NAME } from "@/core/commerce/merchant-identity";
import { defineService, ServiceError, type ServiceContext } from "@/core/service";
import { okResult } from "@/core/contract";
import { bookingCommercialSources, bookings } from "@/core/scheduling/schema";
import { bookingMarketPolicies } from "./booking-merchant-schema";
import { invoiceMerchantCollections } from "@/modules/invoicing/merchant-collection-schema";
import { getInvoiceMerchantTaxReceipt, getInvoiceSiteMerchantIdentity } from "@/modules/invoicing/merchant-tax";
import { invoices, invoiceMarketPolicies, invoiceMerchantAllocations } from "@/modules/invoicing/schema";
import { getInvoiceMarketPolicy, invoiceMarketPolicy, marketFeeMinor, registerInvoiceMarketResolver, registerInvoiceMerchantVerifier } from "@/modules/invoicing/market-policy";
import { orderInvoiceRevenue,orderSellers,orderInvoiceLineOwners } from "@/modules/catalog/market";
import { invoiceMerchantLineOwner, registerInvoiceMerchantLineResolver } from "@/modules/invoicing/merchant-allocations";
import { products, orders } from "@/modules/catalog/schema";
import { orderCommercialTerms } from "@/modules/catalog/order-commercial";
import { plans, subscriptions } from "@/modules/subscriptions/schema";
import { getSubscriptionMarketPolicy, registerSubscriptionMarketResolver, registerSubscriptionPlanMarketResolver, registerSubscriptionMerchantVerifier, subscriptionMarketPolicy, type SubscriptionMarketPolicy } from "@/modules/subscriptions/market-policy";
import { sellerForInvoice } from "./invoice-seller";
import { marketRules } from "./payouts";
import { merchantCollectionReceipt, registerMerchantCollectionResolver, registerMerchantCollectionVerifier, registerMerchantCheckoutRequirement } from "@/modules/invoicing/merchant-collection";
import { memberPayoutAccounts, memberProfiles, memberSettings } from "./schema";

registerMerchantCheckoutRequirement(async ctx => {
  const rules = await marketRules(ctx);
  return rules.enabled && rules.model === "seller_merchant";
});

export async function policyForSellers(sellerIds: string[], containsSiteItems: boolean, ctx: ServiceContext): Promise<SubscriptionMarketPolicy> {
  await lockContactIdentityForRead(ctx.tx);
  // A signup/issue transaction keeps its displayed terms stable through
  // capture. Owner updates wait until this transaction commits.
  await ctx.tx.select({ id: memberSettings.id }).from(memberSettings).where(eq(memberSettings.id, 1)).for("share");
  const rules = await marketRules(ctx);
  const base = { model: rules.model, adapter: rules.adapter, siteFeeBps: rules.siteFeeBps, holdDays: rules.holdDays };
  if (rules.model !== "seller_merchant") return { ...base, sellerUserId: sellerIds.length === 1 ? sellerIds[0]! : null, merchantName: null,merchantSupport:null,merchantContactId:null, providerAccountId: null };
  if (rules.adapter !== "stripe_connect" || sellerIds.length !== 1 || containsSiteItems) throw new ServiceError("conflict", "Direct seller checkout requires one seller and Stripe Connect.");
  if(await merchantIdentityErased(ctx.tx,sellerIds[0]!))throw new ServiceError("conflict","This seller's erased business details cannot authorize a new agreement.");
  const [seller] = await ctx.tx.select({ account: memberPayoutAccounts, profile: memberProfiles })
    .from(memberPayoutAccounts).innerJoin(memberProfiles, eq(memberProfiles.userId, memberPayoutAccounts.userId))
    .where(inArray(memberPayoutAccounts.userId, sellerIds)).for("share");
  if (!seller || seller.profile.status !== "active" || seller.account.adapter !== "stripe_connect" || seller.account.status !== "ready" || !seller.account.chargesReady || !seller.account.externalAccountId || !seller.account.merchantName || seller.account.merchantName === ERASED_MERCHANT_NAME) throw new ServiceError("conflict", "This seller must finish direct-payment setup before an agreement or invoice can be issued.");
  if (!seller.account.merchantSupport) throw new ServiceError("conflict", "This seller must finish their public business support details before an agreement or invoice can be issued.");
  const [contact]=await ctx.tx.select({id:contacts.id}).from(contacts).where(eq(contacts.userId,seller.profile.userId)).limit(1);
  if(!contact)throw new ServiceError("conflict","This seller's public business details need their unified contact record.");
  return { ...base, sellerUserId: seller.profile.userId, merchantName: seller.account.merchantName, merchantSupport:seller.account.merchantSupport,merchantContactId:contact.id, providerAccountId: seller.account.externalAccountId };
}

export const resolveSubscriptionPlanMarketPolicy = defineService({
  name: "members.resolveSubscriptionPlanMarketPolicy", summary: "Resolve a plan's seller and current collection terms before agreement consent.",
  kind: "query", permission: "system", external: false,
  input: z.object({ planId: z.uuid() }), output: subscriptionMarketPolicy.nullable(),
  handler: async ({ planId }, ctx) => {
    const [plan] = await ctx.tx.select({ sellerUserId: products.sellerUserId }).from(plans).innerJoin(products, eq(products.id, plans.productId)).where(eq(plans.id, planId)).limit(1);
    return plan?.sellerUserId ? policyForSellers([plan.sellerUserId], false, ctx) : null;
  },
});
registerSubscriptionPlanMarketResolver((planId, ctx) => ctx.callAsSystem(resolveSubscriptionPlanMarketPolicy, { planId }));

export const resolveSubscriptionMarketPolicy = defineService({
  name: "members.resolveSubscriptionMarketPolicy", summary: "Resolve the seller and collection terms when an agreement starts.",
  kind: "query", permission: "system", external: false,
  input: z.object({ subscriptionId: z.uuid() }), output: subscriptionMarketPolicy.nullable(),
  handler: async ({ subscriptionId }, ctx) => {
    const [subscription] = await ctx.tx.select({ planId: subscriptions.planId }).from(subscriptions).where(eq(subscriptions.id, subscriptionId)).limit(1);
    return subscription ? ctx.callAsSystem(resolveSubscriptionPlanMarketPolicy, { planId: subscription.planId }) : null;
  },
});
registerSubscriptionMarketResolver((subscriptionId, ctx) => ctx.callAsSystem(resolveSubscriptionMarketPolicy, { subscriptionId }));

export const resolveInvoiceMarketPolicy = defineService({
  name: "members.resolveInvoiceMarketPolicy", summary: "Resolve the sellers and collection policy for a new invoice.",
  kind: "query", permission: "system", external: false,
  input: z.object({ invoiceId: z.uuid() }), output: invoiceMarketPolicy.nullable(),
  handler: async ({ invoiceId }, ctx) => {
    await lockContactIdentityForRead(ctx.tx);
    const [invoice] = await ctx.tx.select().from(invoices).where(eq(invoices.id, invoiceId)).limit(1);
    if (!invoice || !invoice.sourceId) return null;
    if (invoice.sourceType === "subscription" && z.uuid().safeParse(invoice.sourceId.split(":")[0]).success) {
      const policy = await ctx.callAsSystem(getSubscriptionMarketPolicy, { subscriptionId: invoice.sourceId.split(":")[0]! });
      const seller = await sellerForInvoice(ctx, invoice);
      if (!policy && !seller) return null;
      if (!policy || policy.sellerUserId !== seller) throw new ServiceError("conflict", "The agreement's original seller needs reconciliation before billing.");
      const erased=policy.sellerUserId&&await merchantIdentityErased(ctx.tx,policy.sellerUserId,policy.merchantContactId);
      return { ...policy,collectionVersion:0,...(erased?{merchantName:ERASED_MERCHANT_NAME,merchantSupport:null}:{}), feeMinor: marketFeeMinor(invoice.totalMinor - invoice.taxMinor, policy.siteFeeBps) };
    }
    if (invoice.sourceType === "booking" && z.uuid().safeParse(invoice.sourceId).success) {
      const [booking] = await ctx.tx.select().from(bookings).where(eq(bookings.id, invoice.sourceId));
      if (!booking) throw new ServiceError("conflict", "The original appointment is unavailable.");
      let frozen: SubscriptionMarketPolicy | null = null;
      if (booking.marketPolicyVersion === 1) {
        const [source] = await ctx.tx.select().from(bookingCommercialSources).where(eq(bookingCommercialSources.bookingId, booking.id));
        if (!booking.serviceOfferingId) return null;
        if (!source) throw new ServiceError("conflict", "Restore the appointment's actual original commercial source before billing.");
        if (!source.sellerUserId) return null;
        const [original] = await ctx.tx.select().from(bookingMarketPolicies).where(eq(bookingMarketPolicies.bookingId, booking.id));
        if (!original || original.sellerUserId !== source.sellerUserId) throw new ServiceError("conflict", "The appointment's original member terms are missing.");
        frozen = subscriptionMarketPolicy.parse(original);
      } else {
        // A real pre80 issued invoice is evidence of an original agreement.
        // Today's offering owner never supplies missing historical ownership.
        const [originalInvoice] = booking.invoiceId ? await ctx.tx.select().from(invoices).where(eq(invoices.id, booking.invoiceId)) : [];
        let cursor: typeof booking | undefined = booking, originalSource = false;
        if (originalInvoice?.sourceType === "booking" && originalInvoice.contactId === booking.contactId) {
          const seen = new Set<string>();
          for (let depth = 0; cursor && depth < 100 && !seen.has(cursor.id); depth++) {
            seen.add(cursor.id);
            if (cursor.id === originalInvoice.sourceId) { originalSource = true; break; }
            const parentId: string | null = cursor.rescheduledFromId;
            cursor = parentId ? (await ctx.tx.select().from(bookings).where(eq(bookings.id, parentId)))[0] : undefined;
          }
        }
        const [original] = originalSource && originalInvoice ? await ctx.tx.select().from(invoiceMarketPolicies).where(eq(invoiceMarketPolicies.invoiceId, originalInvoice.id)) : [];
        if (original) frozen = subscriptionMarketPolicy.parse(original);
        else if (booking.serviceOfferingId) throw new ServiceError("conflict", "This older appointment has no proved original member or site billing policy. Review its actual history before issuing new money.");
      }
      if (!frozen) return null;
      const erased = frozen.sellerUserId && await merchantIdentityErased(ctx.tx, frozen.sellerUserId, frozen.merchantContactId);
      return { ...frozen, collectionVersion: 0, ...(erased ? { merchantName: ERASED_MERCHANT_NAME, merchantSupport: null } : {}), feeMinor: marketFeeMinor(invoice.totalMinor - invoice.taxMinor, frozen.siteFeeBps) };
    }
    if (invoice.sourceType === "order" && z.uuid().safeParse(invoice.sourceId).success) {
      const [order] = await ctx.tx.select({ epoch: orders.commercialEpoch }).from(orders).where(eq(orders.id, invoice.sourceId));
      if (order?.epoch === 1) {
        const original = await ctx.callAsSystem(orderCommercialTerms, { orderId: invoice.sourceId });
        const ownership = await ctx.callAsSystem(orderSellers, { orderId: invoice.sourceId });
        if (!ownership.lines.length) return null;
        if (!original) throw new ServiceError("conflict", "The new order needs its actual pre-draft commercial policy; later site settings cannot supply it.");
        const sellerIds = [...new Set(ownership.lines.map(line => line.sellerUserId))];
        const revenue = await ctx.callAsSystem(orderInvoiceRevenue, { orderId: invoice.sourceId, invoiceId });
        const feeMinor = ownership.lines.reduce((sum, line) => {
          const amount = revenue.find(row => row.orderItemId === line.orderItemId);
          if (!amount) throw new ServiceError("conflict", "The original seller line has no matching invoice revenue.");
          return sum + marketFeeMinor(amount.revenueMinor, original.siteFeeBps);
        }, 0);
        if (original.model === "seller_merchant" && (!original.collectionKind || !original.providerPlatformAccountId || !original.acceptedQuoteDigest || !original.acceptedCommercialDigest || original.adapter !== "stripe_connect")) throw new ServiceError("conflict", "Restore this order's original payment method, business and tax consent before issue.");
        return { model: original.model, adapter: original.adapter, siteFeeBps: original.siteFeeBps, holdDays: original.holdDays, collectionVersion: original.model === "seller_merchant" ? 1 : 0,
          sellerUserId: original.model === "seller_merchant" ? null : sellerIds.length === 1 ? sellerIds[0]! : null, merchantName: null, merchantSupport: null, merchantContactId: null, providerAccountId: null, feeMinor };
      }
    }
    await ctx.tx.select({ id: memberSettings.id }).from(memberSettings).where(eq(memberSettings.id, 1)).for("share");
    const rules = await marketRules(ctx);
    let sellerIds: string[];
    let feeMinor: number;
    let containsSiteItems = false;
    if (invoice.sourceType === "order" && z.uuid().safeParse(invoice.sourceId).success) {
      let order;
      try { order = await ctx.callAsSystem(orderSellers, { orderId: invoice.sourceId }); }
      catch (error) { if (error instanceof ServiceError && error.code === "not_found") return null; throw error; }
      sellerIds = [...new Set(order.lines.map(line => line.sellerUserId))];
      containsSiteItems = order.containsSiteItems;
      const revenue=await ctx.callAsSystem(orderInvoiceRevenue,{orderId:order.orderId,invoiceId});
      feeMinor = order.lines.reduce((total, line) => {
        const original=revenue.find(row=>row.orderItemId===line.orderItemId);
        if(!original)throw new ServiceError("conflict","The original seller line has no invoice revenue.");
        return total+marketFeeMinor(original.revenueMinor,rules.siteFeeBps);
      }, 0);
    } else {
      const seller = await sellerForInvoice(ctx, invoice);
      sellerIds = seller ? [seller] : [];
      feeMinor = marketFeeMinor(invoice.totalMinor - invoice.taxMinor, rules.siteFeeBps);
    }
    if (sellerIds.length === 0) return null;
    return { ...await policyForSellers(sellerIds, containsSiteItems, ctx), collectionVersion:0, feeMinor };
  },
});

registerInvoiceMarketResolver((invoiceId, ctx) => ctx.callAsSystem(resolveInvoiceMarketPolicy, { invoiceId }));

export const resolveInvoiceMerchantLineOwners = defineService({
  name: "members.resolveInvoiceMerchantLineOwners", summary: "Resolve original member order line owners against the unified contact spine.",
  kind: "query", permission: "system", external: false,
  input: z.object({ invoiceId: z.uuid() }), output: invoiceMerchantLineOwner.array().nullable(),
  handler: async ({ invoiceId }, ctx) => {
    await lockContactIdentityForRead(ctx.tx);
    const [invoice] = await ctx.tx.select().from(invoices).where(eq(invoices.id, invoiceId));
    if (!invoice || invoice.sourceType !== "order" || !invoice.sourceId || !z.uuid().safeParse(invoice.sourceId).success) return null;
    const lines = await ctx.callAsSystem(orderInvoiceLineOwners, { orderId: invoice.sourceId, invoiceId });
    const sellerIds = [...new Set(lines.flatMap(line => line.sellerUserId ? [line.sellerUserId] : []))];
    const owners = sellerIds.length ? await ctx.tx.select({ userId: contacts.userId, id: contacts.id }).from(contacts).where(inArray(contacts.userId, sellerIds)) : [];
    return lines.map(line => ({ ...line, merchantContactId: owners.find(owner => owner.userId === line.sellerUserId)?.id ?? null }));
  },
});
registerInvoiceMerchantLineResolver((invoiceId, ctx) => ctx.callAsSystem(resolveInvoiceMerchantLineOwners, { invoiceId }));

export const resolveInvoiceMerchantCollections = defineService({
  name: "members.resolveInvoiceMerchantCollections", summary: "Resolve every original order seller/site business and its exact invoice tax receipt before issue.",
  kind: "query", permission: "system", external: false, input: z.object({ invoiceId: z.uuid() }), output: merchantCollectionReceipt.array(),
  handler: async ({ invoiceId }, ctx) => {
    await lockContactIdentityForRead(ctx.tx);
    const policy = await ctx.callAsSystem(getInvoiceMarketPolicy, { invoiceId });
    const [invoice] = await ctx.tx.select().from(invoices).where(eq(invoices.id, invoiceId));
    const original = invoice?.sourceType === "order" && invoice.sourceId ? await ctx.callAsSystem(orderCommercialTerms, { orderId: invoice.sourceId }) : null;
    if (policy?.collectionVersion !== 1 || policy.model !== "seller_merchant" || original?.model !== "seller_merchant" || !original.collectionKind || !original.providerPlatformAccountId
      || policy.adapter !== original.adapter || policy.siteFeeBps !== original.siteFeeBps || policy.holdDays !== original.holdDays) throw new ServiceError("conflict", "The original pre-draft merchant collection policy is unavailable or differs from this invoice.");
    const parts = await ctx.tx.select().from(invoiceMerchantAllocations).where(eq(invoiceMerchantAllocations.invoiceId, invoiceId));
    const receipts: z.infer<typeof merchantCollectionReceipt>[] = [];
    if (parts.length !== original.parties.length) throw new ServiceError("conflict", "The original merchant portions do not cover this complete invoice.");
    for (const part of parts) {
      const business = original.parties.find(party => party.sellerUserId === part.sellerUserId);
      const taxPolicy = await ctx.callAsSystem(getInvoiceMerchantTaxReceipt, { invoiceId, sellerUserId: part.sellerUserId });
      if (!business || business.merchantContactId !== part.merchantContactId || !business.merchantSupport || business.profileId !== taxPolicy.profileId || business.profileVersion !== taxPolicy.profileVersion || business.liability !== taxPolicy.liability) throw new ServiceError("conflict", "The invoice tax or contact binding differs from its accepted original business.");
      if (part.sellerUserId === null) {
        const identity = await ctx.callAsSystem(getInvoiceSiteMerchantIdentity, { invoiceId });
        if (identity.merchantName !== business.merchantName || JSON.stringify(identity.merchantSupport) !== JSON.stringify(business.merchantSupport) || business.recipientAccountId !== null) throw new ServiceError("conflict", "The site's invoice identity differs from this order's original accepted business.");
        receipts.push({ allocationId: part.id, collectionKind: "platform", providerPlatformAccountId: original.providerPlatformAccountId,
          chargeAccountId: null, recipientAccountId: null, settlementMerchantAccountId: null, ...identity, taxPolicy });
      } else {
        if (!business.recipientAccountId) throw new ServiceError("conflict", "This original seller portion has no accepted collection recipient.");
        receipts.push({ allocationId: part.id, collectionKind: original.collectionKind, providerPlatformAccountId: original.providerPlatformAccountId,
          chargeAccountId: original.collectionKind === "direct" ? business.recipientAccountId : null, recipientAccountId: business.recipientAccountId, settlementMerchantAccountId: business.recipientAccountId,
          merchantName: business.merchantName, merchantSupport: business.merchantSupport, taxPolicy });
      }
    }
    return receipts;
  },
});
registerMerchantCollectionResolver((invoiceId, ctx) => ctx.callAsSystem(resolveInvoiceMerchantCollections, { invoiceId }));

export const verifyInvoiceMerchantCollection = defineService({
  name: "members.verifyInvoiceMerchantCollection", summary: "Verify only the original business of the merchant portion being collected.",
  kind: "query", permission: "system", external: false, input: z.object({ allocationId: z.uuid() }), output: okResult,
  handler: async ({ allocationId }, ctx) => {
    const [original] = await ctx.tx.select({ part: invoiceMerchantAllocations, collection: invoiceMerchantCollections }).from(invoiceMerchantAllocations)
      .innerJoin(invoiceMerchantCollections, eq(invoiceMerchantCollections.allocationId, invoiceMerchantAllocations.id)).where(eq(invoiceMerchantAllocations.id, allocationId));
    if (!original) throw new ServiceError("conflict", "The original merchant portion needs reconciliation.");
    const { part, collection } = original;
    const policy = await ctx.callAsSystem(getInvoiceMarketPolicy, { invoiceId: part.invoiceId });
    if (!policy || policy.collectionVersion !== 1 || policy.model !== "seller_merchant") throw new ServiceError("conflict", "This portion has no original versioned merchant policy.");
    if (part.sellerUserId === null) {
      const identity = await ctx.callAsSystem(getInvoiceSiteMerchantIdentity, { invoiceId: part.invoiceId });
      if (collection.collectionKind !== "platform" || identity.merchantName !== collection.merchantName || JSON.stringify(identity.merchantSupport) !== JSON.stringify(collection.merchantSupport)) throw new ServiceError("conflict", "Restore this invoice's exact original site business identity before collection.");
    } else await verifyMerchantPolicy({ ...policy, sellerUserId: part.sellerUserId, merchantContactId: part.merchantContactId, merchantName: collection.merchantName, merchantSupport: collection.merchantSupport, providerAccountId: collection.recipientAccountId }, ctx);
    return { ok: true as const };
  },
});
registerMerchantCollectionVerifier(async (allocationId, ctx) => { await ctx.callAsSystem(verifyInvoiceMerchantCollection, { allocationId }); });

export const verifyInvoiceMerchantAccount = defineService({
  name: "members.verifyInvoiceMerchantAccount", summary: "Verify that an issued invoice's original seller account remains authorized.",
  kind: "query", permission: "system", external: false,
  input: z.object({ invoiceId: z.uuid() }), output: okResult,
  handler: async ({ invoiceId }, ctx) => {
    const policy = await ctx.callAsSystem(getInvoiceMarketPolicy, { invoiceId });
    if (!policy || policy.model !== "seller_merchant" || !policy.sellerUserId) throw new ServiceError("conflict", "This invoice has no direct seller policy.");
    await verifyMerchantPolicy(policy, ctx);
    return { ok: true as const };
  },
});
registerInvoiceMerchantVerifier(async (invoiceId, ctx) => { await ctx.callAsSystem(verifyInvoiceMerchantAccount, { invoiceId }); });

async function verifyMerchantPolicy(policy: SubscriptionMarketPolicy, ctx: ServiceContext): Promise<void> {
  if (!policy.sellerUserId) throw new ServiceError("conflict", "The original seller is missing.");
  if(policy.merchantName===ERASED_MERCHANT_NAME || await merchantIdentityErased(ctx.tx,policy.sellerUserId,policy.merchantContactId))throw new ServiceError("conflict","This seller's erased business details cannot authorize new collection.");
  const [seller] = await ctx.tx.select({ account: memberPayoutAccounts, profile: memberProfiles })
    .from(memberPayoutAccounts).innerJoin(memberProfiles, eq(memberProfiles.userId, memberPayoutAccounts.userId))
    .where(eq(memberPayoutAccounts.userId, policy.sellerUserId)).limit(1);
  if (!seller || seller.profile.status !== "active" || seller.account.adapter !== policy.adapter || seller.account.status !== "ready" || !seller.account.chargesReady || seller.account.externalAccountId !== policy.providerAccountId || seller.account.merchantName !== policy.merchantName) throw new ServiceError("conflict", "The seller's payment details changed. Review the original agreement before collecting payment.");
}

export const verifySubscriptionMerchantAccount = defineService({
  name: "members.verifySubscriptionMerchantAccount", summary: "Verify the original merchant before saving a card or scheduling seller renewals.",
  kind: "query", permission: "system", external: false,
  input: z.object({ subscriptionId: z.uuid() }), output: okResult,
  handler: async ({ subscriptionId }, ctx) => {
    const policy = await ctx.callAsSystem(getSubscriptionMarketPolicy, { subscriptionId });
    if (!policy || policy.model !== "seller_merchant") throw new ServiceError("conflict", "This agreement has no direct seller merchant.");
    await verifyMerchantPolicy(policy, ctx);
    return { ok: true as const };
  },
});
registerSubscriptionMerchantVerifier(async (subscriptionId, ctx) => { await ctx.callAsSystem(verifySubscriptionMerchantAccount, { subscriptionId }); });
export default [resolveInvoiceMerchantCollections, verifyInvoiceMerchantCollection, resolveInvoiceMarketPolicy, resolveInvoiceMerchantLineOwners, resolveSubscriptionMarketPolicy, resolveSubscriptionPlanMarketPolicy, verifyInvoiceMerchantAccount, verifySubscriptionMerchantAccount];
