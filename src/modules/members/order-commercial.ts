// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Trusted source queries capture current terms before an original order draft.
import { eq } from "drizzle-orm";
import { z } from "zod";
import { publicMerchantSupport } from "@/core/commerce/merchant-identity";
import { lockContactIdentityForRead } from "@/core/contacts/identity-lock";
import { contacts } from "@/core/contacts/schema";
import { defineService, getService, ServiceError, type ServiceContext } from "@/core/service";
import { cartItems, carts, orderItems, orders, products, productVariants } from "@/modules/catalog/schema";
import { currentMerchantTaxProfile } from "@/modules/invoicing/merchant-tax";
import { getMerchantCollectionConfiguration } from "@/modules/invoicing/merchant-collection";
import { policyForSellers } from "./market-merchant";
import { marketRules } from "./payouts";
import { memberSettings } from "./schema";

const account = z.string().regex(/^acct_[A-Za-z0-9]+$/).max(200);
export const currentOrderCommercialTerms = z.object({
  model: z.enum(["hold", "instant", "seller_merchant"]), adapter: z.string(), siteFeeBps: z.number().int().min(0).max(10000), holdDays: z.number().int().min(0).max(365),
  collectionKind: z.enum(["direct", "destination"]).nullable(), providerPlatformAccountId: account.nullable(),
  sellers: z.array(z.object({ sellerUserId: z.uuid().nullable(), merchantContactId: z.uuid().nullable(), merchantName: z.string().nullable(), merchantSupport: publicMerchantSupport.nullable(), recipientAccountId: account.nullable() })),
});

async function termsForOriginalSellers(ctx: ServiceContext, ids: readonly (string | null)[]): Promise<z.infer<typeof currentOrderCommercialTerms>> {
  await lockContactIdentityForRead(ctx.tx);
  await ctx.tx.select({ id: memberSettings.id }).from(memberSettings).where(eq(memberSettings.id, 1)).for("share");
  const rules = await marketRules(ctx), sellerIds = [...new Set(ids.filter((id): id is string => id !== null))];
  if (sellerIds.length && !rules.enabled) throw new ServiceError("conflict", "This site is not currently accepting new member purchases.");
  const configuration = rules.model === "seller_merchant" && sellerIds.length ? await ctx.callAsSystem(getMerchantCollectionConfiguration, {}) : null;
  if (rules.model === "seller_merchant" && sellerIds.length && (!configuration || rules.adapter !== "stripe_connect")) throw new ServiceError("conflict", "Verify the merchant platform before quoting a new member order.");
  const sellers: z.infer<typeof currentOrderCommercialTerms>["sellers"] = [];
  for (const sellerUserId of sellerIds.sort()) {
    const policy = await policyForSellers([sellerUserId], false, ctx);
    const [contact] = await ctx.tx.select({ id: contacts.id }).from(contacts).where(eq(contacts.userId, sellerUserId));
    sellers.push({ sellerUserId, merchantContactId: policy.merchantContactId ?? contact?.id ?? null,
      merchantName: policy.merchantName, merchantSupport: policy.merchantSupport, recipientAccountId: policy.providerAccountId });
  }
  if (configuration && ids.some(id => id === null)) {
    const profile = await ctx.callAsSystem(currentMerchantTaxProfile, { sellerUserId: null });
    const identity = z.object({ merchantName: z.string().min(1).max(200), merchantSupport: publicMerchantSupport }).parse(await ctx.callAsSystem(getService("invoicing.merchantTaxBusinessIdentity"), { profileId: profile.profileId, profileVersion: profile.profileVersion }));
    sellers.unshift({ sellerUserId: null, merchantContactId: null, recipientAccountId: null, ...identity });
  }
  return { model: rules.model, adapter: rules.adapter, siteFeeBps: rules.siteFeeBps, holdDays: rules.holdDays,
    collectionKind: configuration?.collectionKind ?? null, providerPlatformAccountId: configuration?.providerPlatformAccountId ?? null, sellers };
}

export const resolveOrderCommercialTerms = defineService({
  name: "members.resolveOrderCommercialTerms", summary: "Resolve current terms for an actual unbilled order before its source captures an immutable original policy.",
  kind: "query", permission: "system", external: false, input: z.object({ orderId: z.uuid() }), output: currentOrderCommercialTerms,
  handler: async ({ orderId }, ctx) => {
    const [order] = await ctx.tx.select().from(orders).where(eq(orders.id, orderId)).for("share");
    if (!order || order.invoiceId) throw new ServiceError("conflict", "Only the original unbilled order can capture these new commercial terms.");
    const lines = await ctx.tx.select({ snapshot: orderItems.snapshot }).from(orderItems).where(eq(orderItems.orderId, orderId)).for("share");
    if (!lines.length) throw new ServiceError("conflict", "The original order lines are missing.");
    const owner = z.object({ sellerUserId: z.uuid().nullable(), requiresShipping: z.boolean() });
    const parsed = lines.map(line => owner.safeParse(line.snapshot));
    if (parsed.some(line => !line.success)) throw new ServiceError("conflict", "The original line owners are unproved; current product ownership cannot supply a new commercial policy.");
    return termsForOriginalSellers(ctx, parsed.map(line => line.data!.sellerUserId));
  },
});

export const resolveCartCommercialTerms = defineService({
  name: "members.resolveCartCommercialTerms", summary: "Resolve current seller business terms from a real authorized cart without creating a temporary order.",
  kind: "query", permission: "system", external: false, input: z.object({ cartId: z.uuid() }), output: currentOrderCommercialTerms,
  handler: async ({ cartId }, ctx) => {
    // The public cart parent proves its token/session before entering this
    // private phase. A caller-supplied cart UUID is never an external grant.
    const [cart] = await ctx.tx.select({ status: carts.status }).from(carts).where(eq(carts.id, cartId)).for("share");
    if (!cart || cart.status !== "open") throw new ServiceError("conflict", "Quote the current open cart before accepting a new order.");
    const lines = await ctx.tx.select({ sellerUserId: products.sellerUserId }).from(cartItems)
      .innerJoin(productVariants, eq(productVariants.id, cartItems.variantId)).innerJoin(products, eq(products.id, productVariants.productId))
      .where(eq(cartItems.cartId, cartId)).for("share");
    if (!lines.length) throw new ServiceError("conflict", "The actual cart lines are unavailable.");
    return termsForOriginalSellers(ctx, lines.map(line => line.sellerUserId));
  },
});

export default [resolveOrderCommercialTerms, resolveCartCommercialTerms];
