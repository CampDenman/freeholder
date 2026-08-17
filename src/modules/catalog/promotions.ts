// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Coupons, gift cards and cart offers (C5.23).
//
// A coupon becomes invoice line discounts. A gift card becomes customer
// credit, then a normal balance payment. Nothing here invents a second
// money path.

import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { createNotification } from "@/core/notifications/service";
import { registerContactReference } from "@/core/contacts/service";
import { registerContactPrivacySource } from "@/core/privacy/service";
import { defineService, ServiceError, type Tx } from "@/core/service";
import { decimalToMinor } from "@/adapters/payments/currency";
import {
  adjustCustomerBalance,
  applyCustomerBalance,
} from "@/modules/invoicing/advanced-money-service";
import { quoteCoupon } from "./promo-quote";
import {
  cartCoupons,
  cartRecoveries,
  carts,
  couponRedemptions,
  coupons,
  giftCardRedemptions,
  giftCards,
  offerRules,
  productVariants,
  products,
} from "./schema";

const id = z.string().uuid();
const couponCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9-]{2,31}$/, "Use letters, numbers and hyphens.");
const giftCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9-]{7,31}$/, "Gift-card codes are at least eight characters.");

async function pointerUndo(
  table: typeof giftCards | typeof couponRedemptions | typeof giftCardRedemptions,
  contactColumn: typeof giftCards.contactId,
  tx: Tx,
  beforeState: unknown,
  afterState: unknown,
  duplicateId: string,
  label: string,
) {
  const schema = z.array(z.object({ id: z.string().uuid(), contactId: z.string().uuid() }));
  const before = schema.parse(beforeState);
  const after = schema.parse(afterState);
  const current = after.length
    ? await tx
        .select({ id: table.id, contactId: contactColumn })
        .from(table)
        .where(inArray(table.id, after.map((row) => row.id)))
    : [];
  const byId = new Map(current.map((row) => [row.id, row.contactId]));
  if (current.length !== after.length || after.some((row) => byId.get(row.id) !== row.contactId)) {
    throw new ServiceError(
      "conflict",
      `${label} changed after this merge. Leave the merge in place or restore that record first.`,
    );
  }
  const moved = before.filter((row) => row.contactId === duplicateId).map((row) => row.id);
  if (moved.length) {
    await tx.update(table).set({ contactId: duplicateId }).where(inArray(table.id, moved));
  }
}

registerContactReference({
  table: "gift_cards",
  repoint: (tx, from, to) => tx.update(giftCards).set({ contactId: to }).where(eq(giftCards.contactId, from)),
  captureForUndo: async (tx, duplicateId, survivingId) => ({
    state: await tx
      .select({ id: giftCards.id, contactId: giftCards.contactId })
      .from(giftCards)
      .where(inArray(giftCards.contactId, [duplicateId, survivingId])),
    undoable: true,
  }),
  restoreAfterUndo: (tx, before, after, duplicateId) =>
    pointerUndo(giftCards, giftCards.contactId, tx, before, after, duplicateId, "A gift card"),
});

registerContactReference({
  table: "coupon_redemptions",
  repoint: (tx, from, to) =>
    tx.update(couponRedemptions).set({ contactId: to }).where(eq(couponRedemptions.contactId, from)),
  captureForUndo: async (tx, duplicateId, survivingId) => ({
    state: await tx
      .select({ id: couponRedemptions.id, contactId: couponRedemptions.contactId })
      .from(couponRedemptions)
      .where(inArray(couponRedemptions.contactId, [duplicateId, survivingId])),
    undoable: true,
  }),
  restoreAfterUndo: (tx, before, after, duplicateId) =>
    pointerUndo(
      couponRedemptions,
      couponRedemptions.contactId,
      tx,
      before,
      after,
      duplicateId,
      "A coupon redemption",
    ),
});

registerContactReference({
  table: "gift_card_redemptions",
  repoint: (tx, from, to) =>
    tx.update(giftCardRedemptions).set({ contactId: to }).where(eq(giftCardRedemptions.contactId, from)),
  captureForUndo: async (tx, duplicateId, survivingId) => ({
    state: await tx
      .select({ id: giftCardRedemptions.id, contactId: giftCardRedemptions.contactId })
      .from(giftCardRedemptions)
      .where(inArray(giftCardRedemptions.contactId, [duplicateId, survivingId])),
    undoable: true,
  }),
  restoreAfterUndo: (tx, before, after, duplicateId) =>
    pointerUndo(
      giftCardRedemptions,
      giftCardRedemptions.contactId,
      tx,
      before,
      after,
      duplicateId,
      "A gift-card redemption",
    ),
});

registerContactPrivacySource({
  scope: "catalog.promotions",
  tables: ["gift_cards", "gift_card_redemptions", "coupon_redemptions"],
  exportData: async (tx: Tx, contactId: string) => ({
    giftCards: await tx
      .select({ id: giftCards.id, remainingMinor: giftCards.remainingMinor, currency: giftCards.currency })
      .from(giftCards)
      .where(eq(giftCards.contactId, contactId)),
    couponRedemptions: await tx
      .select({ id: couponRedemptions.id, couponId: couponRedemptions.couponId })
      .from(couponRedemptions)
      .where(eq(couponRedemptions.contactId, contactId)),
  }),
  erase: async (tx: Tx, contactId: string) => {
    const open = await tx
      .select({ id: giftCards.id })
      .from(giftCards)
      .where(and(eq(giftCards.contactId, contactId), eq(giftCards.status, "active"), sql`${giftCards.remainingMinor} > 0`));
    if (open.length) {
      throw new ServiceError("conflict", "Active gift cards must be voided or spent before this contact can be erased.");
    }
    const cards = await tx.update(giftCards).set({ contactId: null }).where(eq(giftCards.contactId, contactId)).returning({ id: giftCards.id });
    return { affected: cards.length };
  },
});

async function loadCoupon(tx: Tx, code: string) {
  const [row] = await tx.select().from(coupons).where(eq(coupons.code, code)).limit(1);
  if (!row || !row.active) throw new ServiceError("not_found", "That coupon is not here.");
  const now = Date.now();
  if (row.startsAt && row.startsAt.getTime() > now) throw new ServiceError("validation", "That coupon is not active yet.");
  if (row.endsAt && row.endsAt.getTime() < now) throw new ServiceError("validation", "That coupon has ended.");
  return row;
}

async function assertRedeemable(tx: Tx, coupon: typeof coupons.$inferSelect, contactId: string) {
  if (coupon.maxRedemptions != null) {
    const used = await tx
      .select({ id: couponRedemptions.id })
      .from(couponRedemptions)
      .where(eq(couponRedemptions.couponId, coupon.id));
    if (used.length >= coupon.maxRedemptions) {
      throw new ServiceError("validation", "That coupon has been used up.");
    }
  }
  const mine = await tx
    .select({ id: couponRedemptions.id })
    .from(couponRedemptions)
    .where(and(eq(couponRedemptions.couponId, coupon.id), eq(couponRedemptions.contactId, contactId)));
  if (mine.length >= coupon.perContactLimit) {
    throw new ServiceError("validation", "This contact has already used that coupon.");
  }
}

export const createCoupon = defineService({
  name: "catalog.createCoupon",
  summary: "Create a coupon that later becomes invoice discounts.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    code: couponCode,
    kind: z.enum(["percent", "fixed", "free_shipping"]),
    percentOffPpm: z.number().int().min(1).max(1_000_000).optional(),
    amount: z.string().trim().optional(),
    currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/).optional(),
    minSubtotal: z.string().trim().optional(),
    maxRedemptions: z.number().int().min(1).max(1_000_000).optional(),
    perContactLimit: z.number().int().min(1).max(1_000).default(1),
    startsAt: z.coerce.date().optional(),
    endsAt: z.coerce.date().optional(),
    recovery: z.boolean().default(false),
  }),
  handler: async (input, ctx) => {
    if (input.kind === "percent" && !input.percentOffPpm) {
      throw new ServiceError("validation", "A percent coupon needs a parts-per-million rate.");
    }
    if (input.kind === "fixed" && (!input.amount || !input.currency)) {
      throw new ServiceError("validation", "A fixed coupon needs an amount and a currency.");
    }
    const currency = input.currency ?? null;
    const [row] = await ctx.tx
      .insert(coupons)
      .values({
        code: input.code,
        kind: input.kind,
        percentOffPpm: input.percentOffPpm ?? null,
        amountMinor: input.amount && currency ? decimalToMinor(input.amount, currency) : null,
        currency,
        minSubtotalMinor: input.minSubtotal && currency ? decimalToMinor(input.minSubtotal, currency) : 0,
        maxRedemptions: input.maxRedemptions ?? null,
        perContactLimit: input.perContactLimit,
        startsAt: input.startsAt ?? null,
        endsAt: input.endsAt ?? null,
        recovery: input.recovery,
      })
      .returning();
    ctx.setSubject("coupon", row!.id);
    ctx.queueEvent("catalog.couponCreated", { couponId: row!.id, code: row!.code });
    return row!;
  },
});

export const listCoupons = defineService({
  name: "catalog.listCoupons",
  summary: "Every coupon, newest first.",
  kind: "query",
  permission: "scoped",
  input: z.object({}),
  handler: (_input, ctx) => ctx.tx.select().from(coupons).orderBy(desc(coupons.createdAt)).limit(200),
});

export const applyCouponToCart = defineService({
  name: "catalog.applyCouponToCart",
  summary: "Attach one valid coupon to an open cart.",
  kind: "mutation",
  permission: "public",
  input: z.object({ cartId: id, code: couponCode }),
  handler: async (input, ctx) => {
    const [cart] = await ctx.tx.select().from(carts).where(eq(carts.id, input.cartId)).limit(1);
    if (!cart || cart.status !== "open") throw new ServiceError("not_found", "That cart is not here.");
    const coupon = await loadCoupon(ctx.tx, input.code);
    if (cart.contactId) await assertRedeemable(ctx.tx, coupon, cart.contactId);
    await ctx.tx
      .insert(cartCoupons)
      .values({ cartId: cart.id, couponId: coupon.id })
      .onConflictDoNothing({ target: [cartCoupons.cartId, cartCoupons.couponId] });
    return { cartId: cart.id, coupon };
  },
});

export const quoteCartPromotions = defineService({
  name: "catalog.quoteCartPromotions",
  summary: "Resolve attached coupons into a discount and a free-shipping flag.",
  kind: "query",
  permission: "public",
  input: z.object({
    cartId: id,
    couponCode: couponCode.optional(),
    subtotalMinor: z.number().int().min(0),
    shippingMinor: z.number().int().min(0),
    currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/),
  }),
  handler: async (input, ctx) => {
    const attached = await ctx.tx
      .select({ coupon: coupons })
      .from(cartCoupons)
      .innerJoin(coupons, eq(coupons.id, cartCoupons.couponId))
      .where(eq(cartCoupons.cartId, input.cartId));
    const extras = input.couponCode ? [await loadCoupon(ctx.tx, input.couponCode)] : [];
    const seen = new Set<string>();
    const list = [...attached.map((row) => row.coupon), ...extras].filter((coupon) => {
      if (seen.has(coupon.id)) return false;
      seen.add(coupon.id);
      return coupon.active;
    });
    let discountMinor = 0;
    let freeShipping = false;
    let couponId: string | null = null;
    for (const coupon of list) {
      const quoted = quoteCoupon({
        kind: coupon.kind,
        percentOffPpm: coupon.percentOffPpm,
        amountMinor: coupon.amountMinor,
        currency: coupon.currency,
        minSubtotalMinor: coupon.minSubtotalMinor,
        cartCurrency: input.currency,
        subtotalMinor: input.subtotalMinor,
      });
      if (quoted.freeShipping) freeShipping = true;
      if (quoted.discountMinor > discountMinor) {
        discountMinor = quoted.discountMinor;
        couponId = coupon.id;
      } else if (!couponId && quoted.freeShipping) {
        couponId = coupon.id;
      }
    }
    return {
      discountMinor,
      shippingMinor: freeShipping ? 0 : input.shippingMinor,
      freeShipping,
      couponId,
      coupons: list,
    };
  },
});

export const recordCouponRedemption = defineService({
  name: "catalog.recordCouponRedemption",
  summary: "Record that a coupon was used on an order.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    couponId: id,
    contactId: id,
    orderId: id,
    cartId: id.optional(),
    discountMinor: z.number().int().min(0),
  }),
  handler: async (input, ctx) => {
    const [coupon] = await ctx.tx.select().from(coupons).where(eq(coupons.id, input.couponId)).limit(1);
    if (!coupon) throw new ServiceError("not_found", "That coupon is not here.");
    await assertRedeemable(ctx.tx, coupon, input.contactId);
    const [row] = await ctx.tx
      .insert(couponRedemptions)
      .values({
        couponId: coupon.id,
        contactId: input.contactId,
        orderId: input.orderId,
        cartId: input.cartId ?? null,
        discountMinor: input.discountMinor,
      })
      .returning();
    await ctx.tx
      .update(cartRecoveries)
      .set({ recoveredAt: sql`now()` })
      .where(and(eq(cartRecoveries.couponId, coupon.id), sql`${cartRecoveries.recoveredAt} is null`));
    return row!;
  },
});

export const issueGiftCard = defineService({
  name: "catalog.issueGiftCard",
  summary: "Issue a bearer gift card whose remaining balance is spent through customer credit.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    code: giftCode,
    currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/),
    amount: z.string().trim().min(1),
    contactId: id.optional(),
    expiresAt: z.coerce.date().optional(),
    note: z.string().trim().max(500).optional(),
  }),
  handler: async (input, ctx) => {
    const issuedMinor = decimalToMinor(input.amount, input.currency);
    if (issuedMinor <= 0) throw new ServiceError("validation", "A gift card must be issued for a positive amount.");
    const [row] = await ctx.tx
      .insert(giftCards)
      .values({
        code: input.code,
        currency: input.currency,
        issuedMinor,
        remainingMinor: issuedMinor,
        contactId: input.contactId ?? null,
        expiresAt: input.expiresAt ?? null,
        note: input.note ?? null,
      })
      .returning();
    ctx.setSubject("giftCard", row!.id);
    ctx.queueEvent("catalog.giftCardIssued", { giftCardId: row!.id });
    return row!;
  },
});

export const listGiftCards = defineService({
  name: "catalog.listGiftCards",
  summary: "Issued gift cards, newest first.",
  kind: "query",
  permission: "scoped",
  input: z.object({}),
  handler: (_input, ctx) => ctx.tx.select().from(giftCards).orderBy(desc(giftCards.createdAt)).limit(200),
});

export const applyGiftCardToInvoice = defineService({
  name: "catalog.applyGiftCardToInvoice",
  summary: "Spend a gift card onto an invoice through the customer-credit ledger.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    code: giftCode,
    contactId: id,
    invoiceId: id,
    orderId: id.optional(),
    amountMinor: z.number().int().positive(),
    idempotencyKey: z.string().trim().min(8).max(240),
  }),
  handler: async (input, ctx) => {
    const [card] = await ctx.tx.select().from(giftCards).where(eq(giftCards.code, input.code)).for("update");
    if (!card) throw new ServiceError("not_found", "That gift card is not here.");
    if (card.status !== "active") throw new ServiceError("conflict", "That gift card is no longer active.");
    if (card.expiresAt && card.expiresAt.getTime() < Date.now()) {
      throw new ServiceError("validation", "That gift card has expired.");
    }
    const take = Math.min(card.remainingMinor, input.amountMinor);
    if (take <= 0) throw new ServiceError("validation", "That gift card has no remaining balance.");
    const remaining = card.remainingMinor - take;
    await ctx.tx
      .update(giftCards)
      .set({
        remainingMinor: remaining,
        status: remaining === 0 ? "redeemed" : "active",
        contactId: card.contactId ?? input.contactId,
        updatedAt: sql`now()`,
      })
      .where(eq(giftCards.id, card.id));
    await ctx.tx.insert(giftCardRedemptions).values({
      giftCardId: card.id,
      contactId: input.contactId,
      orderId: input.orderId ?? null,
      amountMinor: take,
    });
    await ctx.callAsSystem(adjustCustomerBalance, {
      contactId: input.contactId,
      currency: card.currency,
      direction: "credit",
      amountMinor: take,
      reason: `Gift card ${card.code}`,
      idempotencyKey: `${input.idempotencyKey}:credit`,
    });
    const applied = await ctx.callAsSystem(applyCustomerBalance, {
      invoiceId: input.invoiceId,
      amountMinor: take,
      idempotencyKey: `${input.idempotencyKey}:apply`,
    });
    return { giftCardId: card.id, amountMinor: take, remainingMinor: remaining, payment: applied.payment };
  },
});

export const createOfferRule = defineService({
  name: "catalog.createOfferRule",
  summary: "Configure a checkout bump or a post-add offer.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    kind: z.enum(["bump", "post_add"]),
    name: z.string().trim().min(1).max(80),
    triggerVariantId: id.optional(),
    offerVariantId: id,
  }),
  handler: async (input, ctx) => {
    const [offer] = await ctx.tx.select({ id: productVariants.id }).from(productVariants).where(eq(productVariants.id, input.offerVariantId)).limit(1);
    if (!offer) throw new ServiceError("not_found", "That offer variant is not here.");
    if (input.triggerVariantId) {
      const [trigger] = await ctx.tx
        .select({ id: productVariants.id })
        .from(productVariants)
        .where(eq(productVariants.id, input.triggerVariantId))
        .limit(1);
      if (!trigger) throw new ServiceError("not_found", "That trigger variant is not here.");
    }
    const [row] = await ctx.tx.insert(offerRules).values(input).returning();
    ctx.setSubject("offerRule", row!.id);
    return row!;
  },
});

export const listOfferRules = defineService({
  name: "catalog.listOfferRules",
  summary: "Configured bumps and post-add offers.",
  kind: "query",
  permission: "scoped",
  input: z.object({}),
  handler: (_input, ctx) => ctx.tx.select().from(offerRules).orderBy(desc(offerRules.createdAt)).limit(200),
});

export const listCartOffers = defineService({
  name: "catalog.listCartOffers",
  summary: "Bumps and post-add offers that apply to the current cart lines.",
  kind: "query",
  permission: "public",
  input: z.object({ cartId: id, justAddedVariantId: id.optional() }),
  handler: async (input, ctx) => {
    const { getCart } = await import("./cart");
    const basket = await ctx.call(getCart, { cartId: input.cartId });
    const inCart = new Set(basket.lines.map((line) => line.variantId));
    const rules = await ctx.tx.select().from(offerRules).where(eq(offerRules.active, true));
    const matches = rules.filter((rule) => {
      if (inCart.has(rule.offerVariantId)) return false;
      if (rule.kind === "bump") return !rule.triggerVariantId || inCart.has(rule.triggerVariantId);
      if (!input.justAddedVariantId) return false;
      return !rule.triggerVariantId || rule.triggerVariantId === input.justAddedVariantId;
    });
    const offers = [];
    for (const rule of matches) {
      const [variant] = await ctx.tx
        .select({ id: productVariants.id, sku: productVariants.sku, productName: products.name })
        .from(productVariants)
        .innerJoin(products, eq(products.id, productVariants.productId))
        .where(eq(productVariants.id, rule.offerVariantId))
        .limit(1);
      if (variant) offers.push({ rule, variant });
    }
    return offers;
  },
});

export const recoverAbandonedCarts = defineService({
  name: "catalog.recoverAbandonedCarts",
  summary: "Send one recovery notice and a one-use coupon for each abandoned contact cart.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({}),
  handler: async (_input, ctx) => {
    const abandoned = await ctx.tx
      .select()
      .from(carts)
      .where(and(eq(carts.status, "abandoned"), sql`${carts.contactId} is not null`))
      .limit(100);
    let sent = 0;
    for (const cart of abandoned) {
      if (!cart.contactId) continue;
      const [existing] = await ctx.tx.select().from(cartRecoveries).where(eq(cartRecoveries.cartId, cart.id)).limit(1);
      if (existing) continue;
      const code = `SAVE-${cart.token.replace(/-/g, "").slice(0, 8).toUpperCase()}`;
      let coupon = (await ctx.tx.select().from(coupons).where(eq(coupons.code, code)).limit(1))[0];
      if (!coupon) {
        coupon = (
          await ctx.tx
            .insert(coupons)
            .values({
              code,
              kind: "percent",
              percentOffPpm: 100_000,
              recovery: true,
              maxRedemptions: 1,
              perContactLimit: 1,
            })
            .returning()
        )[0]!;
      }
      await ctx.tx.insert(cartRecoveries).values({ cartId: cart.id, couponId: coupon.id });
      await ctx.callAsSystem(createNotification, {
        recipient: { kind: "contact", id: cart.contactId },
        topic: "cart.recovery",
        title: "You left something behind",
        body: `Use ${coupon.code} for 10% off if you finish this order.`,
        idempotencyKey: `cart-recovery:${cart.id}`,
        dedupeKey: `cart-recovery:${cart.id}`,
      });
      sent += 1;
    }
    return { sent };
  },
});

export default [
  createCoupon,
  listCoupons,
  applyCouponToCart,
  quoteCartPromotions,
  recordCouponRedemption,
  issueGiftCard,
  listGiftCards,
  applyGiftCardToInvoice,
  createOfferRule,
  listOfferRules,
  listCartOffers,
  recoverAbandonedCarts,
];
