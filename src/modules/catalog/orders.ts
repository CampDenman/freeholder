// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Orders and checkout from a cart (C5.21, C5.22).
//
// Checkout creates the order and the invoice in one transaction. Payment
// settlement stays on the invoicing module; paying the order consumes stock
// holds. Fulfillment shipments are C5.19.

import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { listed, row, timestamp, uuid } from "@/core/contract";
import { registerContactReference } from "@/core/contacts/service";
import { registerContactPrivacySource } from "@/core/privacy/service";
import { listLocations } from "@/core/locations/service";
import { defineService, ServiceError, type Tx } from "@/core/service";
import { QUANTITY_SCALE } from "@/modules/invoicing/money";
import {
  createDraftInvoice,
  getInvoice,
  issueInvoice,
  voidInvoice,
} from "@/modules/invoicing/invoice-service";
import { ORDER_STATUSES } from "./contract";
import { releaseReservation, reserveStock } from "./inventory";
import { attachCartToContact, getCart, requireContactAuthority } from "./cart";
import { quoteShipping } from "./shipping";
import { carts, orderItems, orders, stockReservations } from "./schema";

const id = z.string().uuid();

const orderRow = row({
  id: uuid,
  contactId: uuid,
  cartId: uuid.nullable(),
  invoiceId: uuid.nullable(),
  currency: z.string(),
  status: z.enum(ORDER_STATUSES),
  subtotalMinor: z.number().int(),
  discountMinor: z.number().int(),
  shippingMinor: z.number().int(),
  taxMinor: z.number().int(),
  totalMinor: z.number().int(),
  couponId: uuid.nullable(),
  shippingMethodId: uuid.nullable(),
  shippingAddress: z.unknown().nullable(),
  createdAt: timestamp,
  updatedAt: timestamp,
});
const orderItemRow = row({
  id: uuid,
  orderId: uuid,
  variantId: uuid,
  quantity: z.number().int(),
  unitAmountMinor: z.number().int(),
  lineTotalMinor: z.number().int(),
  snapshot: z.unknown(),
  createdAt: timestamp,
});
const orderDetail = z.object({ order: orderRow, lines: listed(orderItemRow) });
const address = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  street1: z.string().trim().min(1).max(300).optional(),
  city: z.string().trim().max(200).optional(),
  region: z.string().trim().toUpperCase().max(100).optional(),
  postalCode: z.string().trim().toUpperCase().max(30).optional(),
  country: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/),
});

registerContactReference({
  table: "orders",
  repoint: (tx, from, to) =>
    tx.update(orders).set({ contactId: to }).where(eq(orders.contactId, from)),
  captureForUndo: async (tx, duplicateId, survivingId) => ({
    state: await tx
      .select({ id: orders.id, contactId: orders.contactId })
      .from(orders)
      .where(inArray(orders.contactId, [duplicateId, survivingId])),
    undoable: true,
  }),
  restoreAfterUndo: async (tx, beforeState, afterState, duplicateId) => {
    const schema = z.array(z.object({ id: z.string().uuid(), contactId: z.string().uuid() }));
    const before = schema.parse(beforeState);
    const after = schema.parse(afterState);
    const current = after.length
      ? await tx
          .select({ id: orders.id, contactId: orders.contactId })
          .from(orders)
          .where(inArray(orders.id, after.map((row) => row.id)))
      : [];
    const currentById = new Map(current.map((row) => [row.id, row.contactId]));
    if (current.length !== after.length || after.some((row) => currentById.get(row.id) !== row.contactId)) {
      throw new ServiceError("conflict", "An order changed after this merge.");
    }
    const movedIds = before.filter((row) => row.contactId === duplicateId).map((row) => row.id);
    if (movedIds.length) {
      await tx.update(orders).set({ contactId: duplicateId }).where(inArray(orders.id, movedIds));
    }
  },
});

registerContactPrivacySource({
  scope: "catalog.orders",
  tables: ["orders", "order_items"],
  exportData: async (tx: Tx, contactId: string) =>
    tx
      .select({ id: orders.id, status: orders.status, currency: orders.currency, totalMinor: orders.totalMinor })
      .from(orders)
      .where(eq(orders.contactId, contactId)),
  erase: async (tx: Tx, contactId: string) => {
    const rows = await tx
      .select({ id: orders.id, status: orders.status })
      .from(orders)
      .where(eq(orders.contactId, contactId));
    if (rows.some((row) => row.status !== "cancelled" && row.status !== "refunded")) {
      throw new ServiceError(
        "conflict",
        "Open or paid orders must be cancelled or refunded before this contact can be erased.",
      );
    }
    return { affected: rows.length };
  },
});

export const checkoutCart = defineService({
  name: "catalog.checkoutCart",
  writeClass: "money",
  summary: "Turn an open cart into an order and an invoice.",
  kind: "mutation",
  permission: "public",
  input: z.object({
    cartId: id,
    contactId: id,
    idempotencyKey: z.string().trim().min(8).max(240),
    acceptedTerms: z.literal(true),
    shippingAddress: address.optional(),
    shippingMethodId: id.optional(),
    locationId: id.optional(),
    couponCode: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9][A-Z0-9-]{2,31}$/)
      .optional(),
    giftCardCode: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9][A-Z0-9-]{7,31}$/)
      .optional(),
    applyBalance: z.boolean().default(false),
  }),
  output: orderDetail,
  handler: async (input, ctx) => {
    // An order and an invoice against a named contact is authority over that
    // contact, not a formality — see requireContactAuthority. The public
    // storefront checkout (when it lands) verifies the shopper's email first
    // and composes through ctx.callAsSystem.
    requireContactAuthority(ctx, "catalog.checkoutCart");
    let basket = await ctx.call(getCart, { cartId: input.cartId });
    if (basket.cart.status === "converted") {
      const [existing] = await ctx.tx.select().from(orders).where(eq(orders.cartId, basket.cart.id)).limit(1);
      if (existing) return ctx.call(getOrder, { id: existing.id });
      throw new ServiceError("conflict", "That cart was already converted.");
    }
    if (basket.cart.status !== "open" || basket.cart.kind !== "cart") {
      throw new ServiceError("conflict", "Only an open shopping cart can be checked out.");
    }
    if (basket.cart.contactId && basket.cart.contactId !== input.contactId) {
      throw new ServiceError("conflict", "That cart belongs to a different contact.");
    }
    if (!basket.cart.contactId) {
      basket = await ctx.call(attachCartToContact, {
        token: basket.cart.token,
        contactId: input.contactId,
      });
    }
    if (basket.lines.length === 0) {
      throw new ServiceError("validation", "The cart is empty.");
    }
    if (!basket.allPriced) {
      throw new ServiceError("validation", "Every line needs a price in this currency before checkout.");
    }
    if (!basket.allAvailable) {
      throw new ServiceError("validation", "A line is no longer available.");
    }
    const needsShipping = basket.lines.some((line) => line.requiresShipping);
    if (needsShipping && !input.shippingAddress) {
      throw new ServiceError("validation", "A shipping address is required for physical items.");
    }

    let shippingMinor = 0;
    let shippingMethodId: string | null = null;
    if (needsShipping && input.shippingAddress) {
      const quotes = await ctx.callAsSystem(quoteShipping, {
        country: input.shippingAddress.country,
        region: input.shippingAddress.region,
        postal: input.shippingAddress.postalCode,
        currency: basket.cart.currency,
        locationId: input.locationId,
        items: basket.lines.map((line) => ({
          quantity: line.quantity,
          weightG: line.weightG ?? 0,
          priceMinor: line.unitAmountMinor ?? 0,
          lengthMm: line.lengthMm ?? undefined,
          widthMm: line.widthMm ?? undefined,
          heightMm: line.heightMm ?? undefined,
          requiresShipping: line.requiresShipping,
        })),
      });
      if (quotes.needed && quotes.quotes.length === 0) {
        throw new ServiceError("validation", "No shipping method reaches that destination.");
      }
      const chosen = input.shippingMethodId
        ? quotes.quotes.find((quote) => quote.methodId === input.shippingMethodId)
        : quotes.quotes[0];
      if (quotes.needed && !chosen) {
        throw new ServiceError("validation", "That shipping method is not available for this cart.");
      }
      shippingMinor = chosen?.amountMinor ?? 0;
      shippingMethodId = chosen?.methodId ?? null;
    }

    const { quoteCartPromotions } = await import("./promotions");
    const { allocateDiscount } = await import("./promo-quote");
    const promo = await ctx.call(quoteCartPromotions, {
      cartId: basket.cart.id,
      couponCode: input.couponCode,
      subtotalMinor: basket.subtotalMinor,
      shippingMinor,
      currency: basket.cart.currency,
    });
    shippingMinor = promo.shippingMinor;
    const discountShares = allocateDiscount(
      basket.lines.map((line) => line.lineTotalMinor ?? 0),
      promo.discountMinor,
    );

    const [order] = await ctx.tx
      .insert(orders)
      .values({
        contactId: input.contactId,
        cartId: basket.cart.id,
        currency: basket.cart.currency,
        subtotalMinor: basket.subtotalMinor,
        discountMinor: promo.discountMinor,
        shippingMinor,
        taxMinor: 0,
        totalMinor: Math.max(0, basket.subtotalMinor - promo.discountMinor + shippingMinor),
        couponId: promo.couponId,
        shippingMethodId,
        shippingAddress: input.shippingAddress ?? null,
      })
      .returning();

    for (const line of basket.lines) {
      await ctx.tx.insert(orderItems).values({
        orderId: order!.id,
        variantId: line.variantId,
        quantity: line.quantity,
        unitAmountMinor: line.unitAmountMinor!,
        lineTotalMinor: line.lineTotalMinor!,
        snapshot: { sku: line.sku, productName: line.productName, requiresShipping: line.requiresShipping },
        // Provenance survives checkout, or it was never provenance: the
        // owner has to know which gallery and which frame an order line is
        // for long after the cart is gone.
        galleryId: line.galleryId ?? null,
        assetId: line.assetId ?? null,
      });
    }

    const locations = await ctx.callAsSystem(listLocations, {});
    const origin = locations.find((row) => row.isPrimary) ?? locations[0];
    const invoice = await ctx.callAsSystem(createDraftInvoice, {
      contactId: input.contactId,
      currency: basket.cart.currency,
      sourceType: "order",
      sourceId: order!.id,
      idempotencyKey: input.idempotencyKey,
      shippingMinor,
      lines: basket.lines.map((line, index) => ({
        sourceType: "variant",
        sourceId: line.variantId,
        description: `${line.productName} Â· ${line.sku}`,
        quantityMicros: line.quantity * QUANTITY_SCALE,
        unitAmountMinor: line.unitAmountMinor!,
        discountMinor: discountShares[index] ?? 0,
        requiresShipping: line.requiresShipping,
        snapshot: { sku: line.sku },
      })),
      tax:
        needsShipping && input.shippingAddress && origin
          ? {
              mode: "calculate" as const,
              origin: {
                country: origin.country,
                region: origin.region ?? undefined,
                postalCode: origin.postalCode ?? undefined,
                city: origin.city ?? undefined,
              },
              destination: {
                country: input.shippingAddress.country,
                region: input.shippingAddress.region,
                postalCode: input.shippingAddress.postalCode,
                city: input.shippingAddress.city,
              },
            }
          : {
              mode: "not_applicable" as const,
              reason: "This checkout has no taxable origin and destination pair.",
            },
    });
    const issued = await ctx.callAsSystem(issueInvoice, { id: invoice.invoice.id });

    await ctx.tx
      .update(orders)
      .set({
        invoiceId: issued.invoice.id,
        taxMinor: issued.invoice.taxMinor,
        totalMinor: issued.invoice.totalMinor,
        discountMinor: promo.discountMinor,
        couponId: promo.couponId,
      })
      .where(eq(orders.id, order!.id));

    const { recordCouponRedemption, applyGiftCardToInvoice } = await import("./promotions");
    if (promo.couponId) {
      await ctx.call(recordCouponRedemption, {
        couponId: promo.couponId,
        contactId: input.contactId,
        orderId: order!.id,
        cartId: basket.cart.id,
        discountMinor: promo.discountMinor,
      });
    }
    const outstanding = () =>
      Math.max(0, issued.invoice.totalMinor - (issued.invoice.paidMinor ?? 0));
    if (input.giftCardCode && outstanding() > 0) {
      const spent = await ctx.call(applyGiftCardToInvoice, {
        code: input.giftCardCode,
        contactId: input.contactId,
        invoiceId: issued.invoice.id,
        orderId: order!.id,
        amountMinor: outstanding(),
        idempotencyKey: `${input.idempotencyKey}:gift`,
      });
      issued.invoice.paidMinor = (issued.invoice.paidMinor ?? 0) + spent.amountMinor;
      if (issued.invoice.paidMinor >= issued.invoice.totalMinor) issued.invoice.status = "paid";
    }
    if (input.applyBalance && outstanding() > 0) {
      const { getCustomerBalance, applyCustomerBalance } = await import(
        "@/modules/invoicing/advanced-money-service"
      );
      const credit = await ctx.callAsSystem(getCustomerBalance, {
        contactId: input.contactId,
        currency: basket.cart.currency,
      });
      const account = credit.accounts[0];
      const take = Math.min(account?.balanceMinor ?? 0, outstanding());
      if (take > 0) {
        await ctx.callAsSystem(applyCustomerBalance, {
          invoiceId: issued.invoice.id,
          amountMinor: take,
          idempotencyKey: `${input.idempotencyKey}:balance`,
        });
        issued.invoice.paidMinor = (issued.invoice.paidMinor ?? 0) + take;
        if (issued.invoice.paidMinor >= issued.invoice.totalMinor) issued.invoice.status = "paid";
      }
    }
    if (issued.invoice.status === "paid" || issued.invoice.totalMinor === 0) {
      await ctx.call(payOrder, { id: order!.id });
    }

    for (const line of basket.lines) {
      if (line.reservationId) {
        try {
          await ctx.callAsSystem(releaseReservation, { id: line.reservationId });
        } catch {
          /* already gone */
        }
      }
      if (line.locationId) {
        await ctx.callAsSystem(reserveStock, {
          variantId: line.variantId,
          locationId: line.locationId,
          quantity: line.quantity,
          holderType: "order",
          holderId: order!.id,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        });
      }
    }

    await ctx.tx
      .update(carts)
      .set({ status: "converted", contactId: input.contactId, updatedAt: new Date() })
      .where(eq(carts.id, basket.cart.id));

    ctx.setSubject("order", order!.id);
    ctx.queueEvent("catalog.orderPlaced", { orderId: order!.id, invoiceId: issued.invoice.id });
    await ctx.emitTimeline({
      contactId: input.contactId,
      eventType: "order.placed",
      subjectType: "order",
      subjectId: order!.id,
      payload: {
        invoiceId: issued.invoice.id,
        totalMinor: issued.invoice.totalMinor,
        currency: basket.cart.currency,
      },
    });
    return ctx.call(getOrder, { id: order!.id });
  },
});

export const payOrder = defineService({
  name: "catalog.payOrder",
  writeClass: "money",
  summary: "Mark an order paid after its invoice is settled. Stock leaves on shipment.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({ id }),
  output: orderDetail,
  handler: async (input, ctx) => {
    const [order] = await ctx.tx.select().from(orders).where(eq(orders.id, input.id)).for("update");
    if (!order) throw new ServiceError("not_found", "That order is not here.");
    if (order.status !== "pending_payment") {
      throw new ServiceError("conflict", "Only an unpaid order can be marked paid.");
    }
    if (!order.invoiceId) {
      throw new ServiceError("conflict", "That order has no invoice to settle against.");
    }
    const invoice = await ctx.callAsSystem(getInvoice, { id: order.invoiceId });
    if (invoice.invoice.status !== "paid") {
      throw new ServiceError("conflict", "The invoice is not settled yet.");
    }
    const reservations = await ctx.tx
      .select()
      .from(stockReservations)
      .where(
        and(
          eq(stockReservations.holderType, "order"),
          eq(stockReservations.holderId, order.id),
          eq(stockReservations.status, "active"),
        ),
      );
    for (const hold of reservations) {
      await ctx.tx
        .update(stockReservations)
        .set({ expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), updatedAt: new Date() })
        .where(eq(stockReservations.id, hold.id));
    }
    await ctx.tx.update(orders).set({ status: "paid", updatedAt: new Date() }).where(eq(orders.id, order.id));
    const { grantDigitalFulfillment } = await import("./fulfillment");
    await ctx.call(grantDigitalFulfillment, { orderId: order.id });
    ctx.setSubject("order", order.id);
    ctx.queueEvent("catalog.orderPaid", { orderId: order.id });
    await ctx.emitTimeline({
      contactId: order.contactId,
      eventType: "order.paid",
      subjectType: "order",
      subjectId: order.id,
      payload: { invoiceId: order.invoiceId, totalMinor: order.totalMinor, currency: order.currency },
    });
    return ctx.call(getOrder, { id: order.id });
  },
});

export const cancelOrder = defineService({
  name: "catalog.cancelOrder",
  writeClass: "destructive",
  summary: "Cancel an unpaid order and release its stock holds.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({ id }),
  output: orderDetail,
  handler: async (input, ctx) => {
    const [order] = await ctx.tx.select().from(orders).where(eq(orders.id, input.id)).for("update");
    if (!order) throw new ServiceError("not_found", "That order is not here.");
    if (order.status !== "pending_payment") {
      throw new ServiceError("conflict", "Only an unpaid order can be cancelled here.");
    }
    const reservations = await ctx.tx
      .select()
      .from(stockReservations)
      .where(
        and(
          eq(stockReservations.holderType, "order"),
          eq(stockReservations.holderId, order.id),
          eq(stockReservations.status, "active"),
        ),
      );
    for (const hold of reservations) {
      try {
        await ctx.callAsSystem(releaseReservation, { id: hold.id });
      } catch {
        /* already gone */
      }
    }
    if (order.invoiceId) {
      try {
        await ctx.callAsSystem(voidInvoice, { id: order.invoiceId, reason: "Order cancelled." });
      } catch {
        /* already void, or invoicing refused â€” the order still cancels */
      }
    }
    await ctx.tx.update(orders).set({ status: "cancelled", updatedAt: new Date() }).where(eq(orders.id, order.id));
    ctx.setSubject("order", order.id);
    ctx.queueEvent("catalog.orderCancelled", { orderId: order.id });
    await ctx.emitTimeline({
      contactId: order.contactId,
      eventType: "order.cancelled",
      subjectType: "order",
      subjectId: order.id,
      payload: { invoiceId: order.invoiceId },
    });
    return ctx.call(getOrder, { id: order.id });
  },
});

export const getOrder = defineService({
  name: "catalog.getOrder",
  summary: "One order and its lines.",
  kind: "query",
  permission: "public",
  input: z.object({ id }),
  output: orderDetail,
  handler: async (input, ctx) => {
    const [order] = await ctx.tx.select().from(orders).where(eq(orders.id, input.id)).limit(1);
    if (!order) throw new ServiceError("not_found", "That order is not here.");
    const lines = await ctx.tx.select().from(orderItems).where(eq(orderItems.orderId, order.id));
    return { order, lines };
  },
});

export const listOrders = defineService({
  name: "catalog.listOrders",
  summary: "Orders for the owner workspace or one contact.",
  kind: "query",
  permission: "scoped",
  input: z.object({ contactId: id.optional() }),
  output: listed(orderRow),
  handler: (input, ctx) =>
    ctx.tx
      .select()
      .from(orders)
      .where(input.contactId ? eq(orders.contactId, input.contactId) : undefined)
      .orderBy(desc(orders.createdAt))
      .limit(200),
});

export default [checkoutCart, payOrder, cancelOrder, getOrder, listOrders];
