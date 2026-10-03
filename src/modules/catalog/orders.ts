// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Orders and checkout from a cart (C5.21, C5.22).
//
// Checkout creates the order and the invoice in one transaction. Payment
// settlement stays on the invoicing module; paying the order consumes stock
// holds. Fulfillment shipments are C5.19.

import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import { clipSnippet, matchesIlike, registerSearchSource } from "@/core/search/registry";
import { listed, row, timestamp, uuid } from "@/core/contract";
import { registerContactReference } from "@/core/contacts/service";
import { registerContactPrivacySource } from "@/core/privacy/service";
import { listLocations } from "@/core/locations/service";
import { checkCoverage } from "@/core/locations/coverage";
import { defineService, ServiceError, type Tx } from "@/core/service";
import { QUANTITY_SCALE } from "@/modules/invoicing/money";
import { payments } from "@/modules/invoicing/schema";
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
import { issuePass } from "@/core/entitlements/service";
import { carts, orderItems, orderPaymentMilestones, orders, products, productVariants, stockReservations } from "./schema";
import { checkoutSettings, checkoutTermsHash, paymentMilestones, termsSnapshot } from "./checkout-policy";

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
  checkoutTermsSnapshot: z.unknown().nullable(),
  checkoutPaymentSnapshot: z.unknown().nullable(),
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
const paymentMilestoneRow = row({
  id: uuid, orderId: uuid, position: z.number().int(), label: z.string(),
  amountMinor: z.number().int(), releasedAt: timestamp.nullable(),
  releasedBy: z.string().nullable(), createdAt: timestamp,
});
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
  tables: ["orders", "order_items", "order_payment_milestones"],
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
    termsVersion: z.string().trim().min(1).max(100).optional(),
    termsHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
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
    let basket = await ctx.callAsSystem(getCart, { cartId: input.cartId });
    if (basket.cart.status === "converted") {
      const [existing] = await ctx.tx.select().from(orders).where(eq(orders.cartId, basket.cart.id)).limit(1);
      if (existing) return ctx.callAsSystem(getOrder, { id: existing.id });
      throw new ServiceError("conflict", "That cart was already converted.");
    }
    if (basket.cart.status !== "open" || basket.cart.kind !== "cart") {
      throw new ServiceError("conflict", "Only an open shopping cart can be checked out.");
    }
    if (basket.cart.contactId && basket.cart.contactId !== input.contactId) {
      throw new ServiceError("conflict", "That cart belongs to a different contact.");
    }
    if (!basket.cart.contactId) {
      if (!basket.cart.token) throw new ServiceError("conflict", "The checked-out cart has no private token.");
      basket = await ctx.callAsSystem(attachCartToContact, {
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
    const settings = await checkoutSettings(ctx);
    if (settings.checkoutPayment.mode === "milestones" && settings.checkoutPayment.currency !== basket.cart.currency) {
      throw new ServiceError("conflict", "The checkout payment policy does not match this cart's currency.");
    }
    if (settings.checkoutTerms && (settings.checkoutTerms.version !== input.termsVersion || checkoutTermsHash(settings.checkoutTerms.body) !== input.termsHash)) {
      throw new ServiceError("conflict", "The checkout terms changed. Review and accept the current version.");
    }
    const needsShipping = basket.lines.some((line) => line.requiresShipping);
    if (needsShipping && !input.shippingAddress) {
      throw new ServiceError("validation", "A shipping address is required for physical items.");
    }

    // C6.18: the coverage check a visitor ran on the page was information;
    // this is the gate. The order's destination is re-validated against the
    // areas the owner actually named, in the same transaction, because a
    // client-side answer is a hint and only the server can refuse. A definite
    // "outside" refuses cleanly; "unconfirmed" never does — coverage is never
    // inferred in either direction, so an address an unnamed area might reach
    // is never turned away on a guess.
    if (needsShipping && input.shippingAddress?.postalCode) {
      const coverage = await ctx.callAsSystem(checkCoverage, {
        postalCode: input.shippingAddress.postalCode,
        locationId: input.locationId,
      });
      if (coverage.answer === "outside") {
        throw new ServiceError(
          "validation",
          `${coverage.postalCode} is outside the areas we have listed for delivery. Check the postcode, or contact us and we will tell you whether we can come to you.`,
        );
      }
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
    const promo = await ctx.callAsSystem(quoteCartPromotions, {
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
        checkoutTermsSnapshot: settings.checkoutTerms ? termsSnapshot(settings.checkoutTerms, new Date()) : null,
        checkoutPaymentSnapshot: settings.checkoutPayment,
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

    if (settings.checkoutPayment.mode === "milestones") {
      const stages = paymentMilestones(issued.invoice.totalMinor, settings.checkoutPayment);
      await ctx.tx.insert(orderPaymentMilestones).values(stages.map((stage, position) => ({
        orderId: order!.id,
        position,
        label: stage.label,
        amountMinor: stage.amountMinor,
        releasedAt: position === 0 ? new Date() : null,
        releasedBy: position === 0 ? "checkout" : null,
      })));
    }

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
          expiresAt: new Date(Date.now() + (issued.invoice.paidMinor > 0 ? 30 : 7) * 86_400_000),
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
    return ctx.callAsSystem(getOrder, { id: order!.id });
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
    if (["paid", "fulfilling", "fulfilled"].includes(order.status)) {
      return ctx.callAsSystem(getOrder, { id: order.id });
    }
    if (order.status !== "pending_payment" && order.status !== "partially_paid") {
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
    const lines = await ctx.tx
      .select({
        quantity: orderItems.quantity,
        productId: products.id,
        productName: products.name,
        kind: products.kind,
      })
      .from(orderItems)
      .innerJoin(productVariants, eq(productVariants.id, orderItems.variantId))
      .innerJoin(products, eq(products.id, productVariants.productId))
      .where(eq(orderItems.orderId, order.id));
    for (const line of lines) {
      if (line.kind !== "pass") continue;
      const punches =
        line.quantity >= QUANTITY_SCALE
          ? Math.max(1, Math.floor(line.quantity / QUANTITY_SCALE))
          : Math.max(1, line.quantity);
      await ctx.callAsSystem(issuePass, {
        contactId: order.contactId,
        productId: line.productId,
        productName: line.productName,
        quantity: punches,
        sourceOrderId: order.id,
      });
    }
    ctx.setSubject("order", order.id);
    ctx.queueEvent("catalog.orderPaid", { orderId: order.id });
    await ctx.emitTimeline({
      contactId: order.contactId,
      eventType: "order.paid",
      subjectType: "order",
      subjectId: order.id,
      payload: { invoiceId: order.invoiceId, totalMinor: order.totalMinor, currency: order.currency },
    });
    return ctx.callAsSystem(getOrder, { id: order.id });
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
    if (order.invoiceId) {
      const invoice = await ctx.callAsSystem(getInvoice, { id: order.invoiceId });
      if (invoice.invoice.paidMinor > 0) {
        throw new ServiceError("conflict", "This order has a payment. Resolve its refund before cancelling.");
      }
      await ctx.callAsSystem(voidInvoice, { id: order.invoiceId, reason: "Order cancelled." });
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
    return ctx.callAsSystem(getOrder, { id: order.id });
  },
});

export const releaseOrderPaymentMilestone = defineService({
  name: "catalog.releaseOrderPaymentMilestone",
  writeClass: "money",
  summary: "Release the next owner-approved order milestone after earlier payments settle.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({ orderId: id, position: z.number().int().positive() }),
  output: paymentMilestoneRow,
  handler: async (input, ctx) => {
    const [order] = await ctx.tx.select().from(orders).where(eq(orders.id, input.orderId)).for("update");
    if (!order || !order.invoiceId) throw new ServiceError("not_found", "That order is not here.");
    const stages = await ctx.tx.select().from(orderPaymentMilestones)
      .where(eq(orderPaymentMilestones.orderId, order.id)).orderBy(orderPaymentMilestones.position);
    const stage = stages[input.position];
    if (!stage || stage.position !== input.position) throw new ServiceError("not_found", "That payment milestone is not here.");
    if (stage.releasedAt) return stage;
    if (order.status !== "partially_paid") {
      throw new ServiceError("conflict", "Only a partially paid order can release another payment.");
    }
    if (stages.find((candidate) => !candidate.releasedAt)?.position !== input.position) {
      throw new ServiceError("conflict", "Milestones must be released in order.");
    }
    const invoice = await ctx.callAsSystem(getInvoice, { id: order.invoiceId });
    const priorMinor = stages.slice(0, input.position).reduce((sum, item) => sum + item.amountMinor, 0);
    if (invoice.invoice.paidMinor < priorMinor) {
      throw new ServiceError("conflict", "The previous payment must settle before the next milestone is released.");
    }
    const [active] = await ctx.tx.select({ id: payments.id }).from(payments).where(and(
      eq(payments.invoiceId, order.invoiceId), inArray(payments.status, ["created", "processing"]),
    )).limit(1);
    if (active) throw new ServiceError("conflict", "A payment attempt needs reconciliation before the next milestone is released.");
    const [updated] = await ctx.tx.update(orderPaymentMilestones)
      .set({ releasedAt: new Date(), releasedBy: ctx.actor.kind === "user" ? ctx.actor.userId : ctx.actor.kind })
      .where(eq(orderPaymentMilestones.id, stage.id)).returning();
    ctx.setSubject("order", order.id);
    ctx.queueEvent("catalog.orderPaymentReleased", { orderId: order.id, milestoneId: stage.id, position: stage.position });
    await ctx.emitTimeline({ contactId: order.contactId, eventType: "order.paymentReleased", subjectType: "order", subjectId: order.id,
      payload: { milestoneId: stage.id, position: stage.position, amountMinor: stage.amountMinor, currency: order.currency } });
    return updated!;
  },
});

export const getOrder = defineService({
  name: "catalog.getOrder",
  summary: "One order and its lines for an authorized catalog reader.",
  kind: "query",
  permission: "scoped",
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
  // C8.11: the customer this asks about may ask it themselves. The
  // contract layer verifies the field is present and is their own contact
  // before the handler runs, so this widens what a customer can *see*
  // about themselves and nothing else.
  selfService: { contactField: "contactId" },
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

registerSearchSource({
  kind: "order", module: "catalog", readService: "catalog.getOrder", tables: ["orders", "order_items"],
  search: async ({ tx, pattern, limit }) => {
    const rows = await tx.select({ id: orders.id, contactId: orders.contactId,
      product: sql<string | null>`(select oi.snapshot->>'productName' from order_items oi where oi.order_id = ${orders.id} order by oi.id limit 1)` })
      .from(orders).where(or(matchesIlike(sql`${orders.id}::text`, pattern), matchesIlike(sql`${orders.contactId}::text`, pattern),
        sql`exists (select 1 from order_items oi where oi.order_id = ${orders.id} and
          ((oi.snapshot->>'productName') ilike ${pattern} escape ${"\\"} or (oi.snapshot->>'sku') ilike ${pattern} escape ${"\\"}))`))
      .orderBy(desc(orders.createdAt), desc(orders.id)).limit(limit);
    return rows.map(item => ({ kind: "order", id: item.id, title: item.id.slice(0, 8), href: `/admin/orders/${item.id}`,
      snippet: clipSnippet(item.product), contactId: item.contactId, module: "catalog" }));
  },
});

export default [checkoutCart, payOrder, cancelOrder, releaseOrderPaymentMilestone, getOrder, listOrders];
