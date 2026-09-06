// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Coupons, gift cards and cart offers (C5.23).
//
// A coupon becomes invoice line discounts. A gift card becomes customer
// credit, then a normal balance payment. Nothing here invents a second
// money path.

import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { listed, row, timestamp, uuid } from "@/core/contract";
import { createNotification } from "@/core/notifications/service";
import { registerContactReference, resolveContact } from "@/core/contacts/service";
import { registerContactPrivacySource } from "@/core/privacy/service";
import { sendMail } from "@/core/mail/service";
import { businessProfile } from "@/core/settings/schema";
import { env } from "@/core/env";
import { defineService, ServiceError, type Tx } from "@/core/service";
import { decimalToMinor } from "@/adapters/payments/currency";
import {
  adjustCustomerBalance,
  applyCustomerBalance,
} from "@/modules/invoicing/advanced-money-service";
import { paymentRow } from "@/modules/invoicing/contract";
import { COUPON_KINDS, GIFT_CARD_STATUSES, OFFER_RULE_KINDS } from "./contract";
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
import { hashCatalogShareToken, newCatalogShareToken } from "./tokens";

const id = z.string().uuid();

const couponRow = row({
  id: uuid,
  code: z.string(),
  kind: z.enum(COUPON_KINDS),
  percentOffPpm: z.number().int().nullable(),
  amountMinor: z.number().int().nullable(),
  currency: z.string().nullable(),
  minSubtotalMinor: z.number().int(),
  maxRedemptions: z.number().int().nullable(),
  perContactLimit: z.number().int(),
  startsAt: timestamp.nullable(),
  endsAt: timestamp.nullable(),
  active: z.boolean(),
  recovery: z.boolean(),
  createdAt: timestamp,
  updatedAt: timestamp,
});
const couponRedemptionRow = row({
  id: uuid,
  couponId: uuid,
  contactId: uuid,
  orderId: uuid.nullable(),
  cartId: uuid.nullable(),
  discountMinor: z.number().int(),
  createdAt: timestamp,
});
const giftCardRow = row({
  id: uuid,
  code: z.string(),
  currency: z.string(),
  issuedMinor: z.number().int(),
  remainingMinor: z.number().int(),
  contactId: uuid.nullable(),
  status: z.enum(GIFT_CARD_STATUSES),
  expiresAt: timestamp.nullable(),
  note: z.string().nullable(),
  createdAt: timestamp,
  updatedAt: timestamp,
});
const offerRuleRow = row({
  id: uuid,
  kind: z.enum(OFFER_RULE_KINDS),
  name: z.string(),
  triggerVariantId: uuid.nullable(),
  offerVariantId: uuid,
  active: z.boolean(),
  createdAt: timestamp,
  updatedAt: timestamp,
});
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

async function emptySafeUndo(
  tx: Tx,
  countRows: () => Promise<{ id: string }[]>,
  blocker: string,
) {
  const rows = await countRows();
  return {
    state: rows,
    undoable: rows.length === 0,
    blocker: rows.length === 0 ? undefined : blocker,
  };
}

registerContactReference({
  table: "gift_cards",
  repoint: (tx, from, to) => tx.update(giftCards).set({ contactId: to }).where(eq(giftCards.contactId, from)),
  captureForUndo: (tx, duplicateId, survivingId) =>
    emptySafeUndo(
      tx,
      () =>
        tx
          .select({ id: giftCards.id })
          .from(giftCards)
          .where(inArray(giftCards.contactId, [duplicateId, survivingId])),
      "Gift cards were moved and cannot be split back apart safely.",
    ),
  restoreAfterUndo: async () => undefined,
});

registerContactReference({
  table: "coupon_redemptions",
  repoint: (tx, from, to) =>
    tx.update(couponRedemptions).set({ contactId: to }).where(eq(couponRedemptions.contactId, from)),
  captureForUndo: (tx, duplicateId, survivingId) =>
    emptySafeUndo(
      tx,
      () =>
        tx
          .select({ id: couponRedemptions.id })
          .from(couponRedemptions)
          .where(inArray(couponRedemptions.contactId, [duplicateId, survivingId])),
      "Coupon redemptions were moved and cannot be split back apart safely.",
    ),
  restoreAfterUndo: async () => undefined,
});

registerContactReference({
  table: "gift_card_redemptions",
  repoint: (tx, from, to) =>
    tx.update(giftCardRedemptions).set({ contactId: to }).where(eq(giftCardRedemptions.contactId, from)),
  captureForUndo: (tx, duplicateId, survivingId) =>
    emptySafeUndo(
      tx,
      () =>
        tx
          .select({ id: giftCardRedemptions.id })
          .from(giftCardRedemptions)
          .where(inArray(giftCardRedemptions.contactId, [duplicateId, survivingId])),
      "Gift-card redemptions were moved and cannot be split back apart safely.",
    ),
  restoreAfterUndo: async () => undefined,
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
  output: couponRow,
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
  output: listed(couponRow),
  handler: (_input, ctx) => ctx.tx.select().from(coupons).orderBy(desc(coupons.createdAt)).limit(200),
});

export const applyCouponToCart = defineService({
  name: "catalog.applyCouponToCart",
  summary: "Attach one valid coupon to an open cart.",
  kind: "mutation",
  permission: "public",
  input: z.object({ cartId: id, code: couponCode }),
  output: z.object({ cartId: uuid, coupon: couponRow }),
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
  output: z.object({
    discountMinor: z.number().int(),
    shippingMinor: z.number().int(),
    freeShipping: z.boolean(),
    couponId: uuid.nullable(),
    coupons: listed(couponRow),
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
  output: couponRedemptionRow,
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
  output: giftCardRow,
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

export const sendGiftCard = defineService({
  name: "catalog.sendGiftCard",
  summary: "Send a gift card to someone as a claim link, resolved as a Contact.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "write",
  input: z.object({
    id,
    email: z.string().trim().email().toLowerCase(),
    name: z.string().trim().min(1).max(200).optional(),
  }),
  rateLimit: {
    limit: 8,
    windowSeconds: 15 * 60,
    subject: (input) => `gift-card-send:${input.id}`,
    message: "Too many sends. Wait a few minutes and try again.",
  },
  output: z.object({
    id: uuid,
    contactId: uuid,
    token: z.string(),
    link: z.string(),
    delivers: z.boolean(),
  }),
  handler: async (input, ctx) => {
    const [card] = await ctx.tx.select().from(giftCards).where(eq(giftCards.id, input.id)).limit(1);
    if (!card) throw new ServiceError("not_found", "That gift card is not here.");
    if (card.status !== "active" || card.remainingMinor <= 0) {
      throw new ServiceError("conflict", "That gift card cannot be sent.");
    }
    const resolved = await ctx.callAsSystem(resolveContact, {
      email: input.email,
      name: input.name,
      source: "gift-card",
    });
    const token = newCatalogShareToken();
    const shareTokenHash = hashCatalogShareToken("gift-card", token);
    await ctx.tx
      .update(giftCards)
      .set({
        contactId: resolved.contact.id,
        shareTokenHash,
        updatedAt: sql`now()`,
      })
      .where(eq(giftCards.id, card.id));
    const link = `${env().APP_URL.replace(/\/+$/, "")}/gift/${encodeURIComponent(token)}`;
    const [business] = await ctx.tx
      .select({ name: businessProfile.name })
      .from(businessProfile)
      .limit(1);
    const site = business?.name ?? "this Freeholder site";
    let delivers = false;
    try {
      const sent = await sendMail(
        ctx.tx,
        {
          to: resolved.contact.email ?? input.email,
          subject: `A gift card from ${site}`,
          text: [
            `${site} sent you a gift card.`,
            "",
            "Open it here. This link is private to you:",
            link,
            "",
            card.expiresAt
              ? `It stops working ${card.expiresAt.toISOString()}.`
              : "Please do not forward this link.",
          ].join("\n"),
        },
        {
          requestedBy: "system",
          idempotencyKey: `gift-card:${card.id}:${shareTokenHash.slice(0, 32)}`,
        },
      );
      delivers = sent.delivers;
    } catch {
      delivers = false;
    }
    ctx.setSubject("giftCard", card.id);
    await ctx.emitTimeline({
      contactId: resolved.contact.id,
      eventType: "catalog.giftCardSent",
      subjectType: "contact",
      subjectId: resolved.contact.id,
      payload: { giftCardId: card.id },
    });
    ctx.queueEvent("catalog.giftCardSent", {
      giftCardId: card.id,
      contactId: resolved.contact.id,
    });
    return {
      id: card.id,
      contactId: resolved.contact.id,
      token,
      link,
      delivers,
    };
  },
});

export const giftCardByShareToken = defineService({
  name: "catalog.giftCardByShareToken",
  summary: "Open a gift card from its claim link.",
  kind: "query",
  permission: "public",
  mcpExclude: true,
  agentCallable: false,
  input: z.object({ token: z.string().trim().min(16).max(200) }),
  output: z
    .object({
      remainingMinor: z.number().int(),
      issuedMinor: z.number().int(),
      currency: z.string(),
      code: z.string(),
      expiresAt: timestamp.nullable(),
      status: z.enum(GIFT_CARD_STATUSES),
    })
    .nullable(),
  handler: async (input, ctx) => {
    const [card] = await ctx.tx
      .select()
      .from(giftCards)
      .where(eq(giftCards.shareTokenHash, hashCatalogShareToken("gift-card", input.token)))
      .limit(1);
    if (!card) return null;
    return {
      remainingMinor: card.remainingMinor,
      issuedMinor: card.issuedMinor,
      currency: card.currency,
      code: card.code,
      expiresAt: card.expiresAt,
      status: card.status,
    };
  },
});

export const listGiftCards = defineService({
  name: "catalog.listGiftCards",
  summary: "Issued gift cards, newest first.",
  kind: "query",
  permission: "scoped",
  input: z.object({}),
  output: listed(giftCardRow),
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
  output: z.object({
    giftCardId: uuid,
    amountMinor: z.number().int(),
    remainingMinor: z.number().int(),
    payment: paymentRow,
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
  output: offerRuleRow,
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
  output: listed(offerRuleRow),
  handler: (_input, ctx) => ctx.tx.select().from(offerRules).orderBy(desc(offerRules.createdAt)).limit(200),
});

export const listCartOffers = defineService({
  name: "catalog.listCartOffers",
  summary: "Bumps and post-add offers that apply to the current cart lines.",
  kind: "query",
  permission: "public",
  input: z.object({ cartId: id, justAddedVariantId: id.optional() }),
  output: listed(
    z.object({
      rule: offerRuleRow,
      variant: row({ id: uuid, sku: z.string(), productName: z.string() }),
    }),
  ),
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
  output: z.object({ sent: z.number().int() }),
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
  sendGiftCard,
  giftCardByShareToken,
  listGiftCards,
  applyGiftCardToInvoice,
  createOfferRule,
  listOfferRules,
  listCartOffers,
  recoverAbandonedCarts,
];
