// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Shipments, digital grants and returns (C5.19).
//
// Split fulfillments are normal. Stock leaves the shelf when a physical
// shipment ships (consume or sale movement), not when the invoice is paid.
// Digital lines never enter a carton. Returns restock through the ledger and
// refund through the existing invoice.

import { and, asc, desc, eq, inArray, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import { listed, row, timestamp, uuid } from "@/core/contract";
import { registerContactReference } from "@/core/contacts/service";
import { registerContactPrivacySource } from "@/core/privacy/service";
import {notifyCommerceContact} from "./return-notifications";
import { defineService, ServiceError, type ServiceContext, type Tx } from "@/core/service";
import refundServices from "./return-refunds";
import {legacyReturnBankPlan} from "./legacy-return-bank-recovery";
export {recoverReturnBankRefunds,replaceReturnBankRefunds} from "./legacy-return-bank-recovery";
import {returnDetail,returnRequestRow} from "./return-contract";
export {refundReturn,submitReturnProviderRefund,prepareReturnRefund,getReturnRefundPlan,claimReturnProviderRefund,reconcileReturnProviderRefunds,onReturnRefundSucceeded,onReturnBankRefundStateChanged} from "./return-refunds";
import {
  FULFILLMENT_KINDS,
  FULFILLMENT_STATUSES,
  ORDER_STATUSES,
} from "./contract";
import { consumeReservation, recordStockMovement, releaseReservation, reserveStock } from "./inventory";
import {
  digitalDeliveries,
  fulfillmentItems,
  fulfillments,
  inventoryItems,
  orderItems,
  orders,
  productMedia,
  productVariants,
  returnItems,
  returnRequests,
  returnRefundAllocations,
  stockReservations,
} from "./schema";

const id = z.string().uuid();

const fulfillmentRow = row({
  id: uuid,
  orderId: uuid,
  locationId: uuid.nullable(),
  kind: z.enum(FULFILLMENT_KINDS),
  status: z.enum(FULFILLMENT_STATUSES),
  boxId: uuid.nullable(),
  weightG: z.number().int().nullable(),
  carrier: z.string().nullable(),
  service: z.string().nullable(),
  trackingNumber: z.string().nullable(),
  trackingUrl: z.string().nullable(),
  shippedAt: timestamp.nullable(),
  deliveredAt: timestamp.nullable(),
  note: z.string().nullable(),
  createdAt: timestamp,
  updatedAt: timestamp,
});
const fulfillmentItemRow = row({
  id: uuid,
  fulfillmentId: uuid,
  orderItemId: uuid,
  quantity: z.number().int(),
  createdAt: timestamp,
});
const fulfillmentDetail = z.object({
  fulfillment: fulfillmentRow,
  items: listed(fulfillmentItemRow),
});
const digitalDeliveryRow = row({
  id: uuid,
  orderId: uuid,
  orderItemId: uuid,
  token: z.string(),
  assetId: uuid.nullable(),
  grantedAt: timestamp,
  downloadedAt: timestamp.nullable(),
  createdAt: timestamp,
});
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

registerContactReference({
  table: "return_requests",
  repoint: (tx, from, to) =>
    tx.update(returnRequests).set({ contactId: to }).where(eq(returnRequests.contactId, from)),
  captureForUndo: async (tx, duplicateId, survivingId) => ({
    state: await tx
      .select({ id: returnRequests.id, contactId: returnRequests.contactId })
      .from(returnRequests)
      .where(inArray(returnRequests.contactId, [duplicateId, survivingId])),
    undoable: true,
  }),
  restoreAfterUndo: async (tx, beforeState, afterState, duplicateId) => {
    const schema = z.array(z.object({ id: z.string().uuid(), contactId: z.string().uuid() }));
    const before = schema.parse(beforeState);
    const after = schema.parse(afterState);
    const current = after.length
      ? await tx
          .select({ id: returnRequests.id, contactId: returnRequests.contactId })
          .from(returnRequests)
          .where(inArray(returnRequests.id, after.map((row) => row.id)))
      : [];
    const currentById = new Map(current.map((row) => [row.id, row.contactId]));
    if (current.length !== after.length || after.some((row) => currentById.get(row.id) !== row.contactId)) {
      throw new ServiceError("conflict", "A return changed after this merge.");
    }
    const movedIds = before.filter((row) => row.contactId === duplicateId).map((row) => row.id);
    if (movedIds.length) {
      await tx.update(returnRequests).set({ contactId: duplicateId }).where(inArray(returnRequests.id, movedIds));
    }
  },
});

registerContactPrivacySource({
  scope: "catalog.returns",
  tables: ["return_requests", "return_items", "return_refund_allocations"],
  exportData: async (tx: Tx, contactId: string) => {
    const requests=await tx.select().from(returnRequests).where(eq(returnRequests.contactId,contactId));
    return Promise.all(requests.map(async request=>({id:request.id,orderId:request.orderId,status:request.status,reason:request.reason,
      items:await tx.select({orderItemId:returnItems.orderItemId,quantity:returnItems.quantity,restockedQuantity:returnItems.restockedQuantity}).from(returnItems).where(eq(returnItems.returnId,request.id)),
      refundAllocations:await tx.select({amountMinor:returnRefundAllocations.amountMinor,currency:returnRefundAllocations.currency,provider:returnRefundAllocations.provider}).from(returnRefundAllocations).where(eq(returnRefundAllocations.returnId,request.id)),
    })));
  },
  erase: async (tx: Tx, contactId: string) => {
    const rows = await tx
      .select({ id: returnRequests.id, status: returnRequests.status })
      .from(returnRequests)
      .where(eq(returnRequests.contactId, contactId));
    if (rows.some((row) => row.status !== "refunded" && row.status !== "rejected")) {
      throw new ServiceError("conflict", "Open returns must be refunded or rejected before this contact can be erased.");
    }
    return { affected: rows.length };
  },
});

async function allocatedQty(tx: Tx, orderItemId: string, exceptFulfillmentId?: string) {
  const rows = await tx
    .select({
      quantity: fulfillmentItems.quantity,
      status: fulfillments.status,
      fulfillmentId: fulfillments.id,
    })
    .from(fulfillmentItems)
    .innerJoin(fulfillments, eq(fulfillments.id, fulfillmentItems.fulfillmentId))
    .where(eq(fulfillmentItems.orderItemId, orderItemId));
  return rows
    .filter((row) => row.status !== "failed" && row.status !== "returned")
    .filter((row) => row.fulfillmentId !== exceptFulfillmentId)
    .reduce((sum, row) => sum + row.quantity, 0);
}

async function refreshOrderStatus(ctx: ServiceContext, orderId: string) {
  const [order] = await ctx.tx.select().from(orders).where(eq(orders.id, orderId)).limit(1);
  if (!order || order.status === "cancelled" || order.status === "refunded" || order.status === "pending_payment" || order.status === "partially_paid") {
    return order ?? null;
  }
  const lines = await ctx.tx
    .select({ item: orderItems, requiresShipping: productVariants.requiresShipping })
    .from(orderItems)
    .innerJoin(productVariants, eq(productVariants.id, orderItems.variantId))
    .where(eq(orderItems.orderId, orderId));
  const ships = lines.filter((row) => row.requiresShipping);
  const digital = lines.filter((row) => !row.requiresShipping);
  const grants = digital.length
    ? await ctx.tx.select().from(digitalDeliveries).where(eq(digitalDeliveries.orderId, orderId))
    : [];
  const digitalDone = digital.every((row) => grants.some((grant) => grant.orderItemId === row.item.id));
  let physicalDone = ships.length === 0;
  if (ships.length) {
    physicalDone = true;
    for (const row of ships) {
      const outbound = await ctx.tx
        .select({ quantity: fulfillmentItems.quantity, status: fulfillments.status })
        .from(fulfillmentItems)
        .innerJoin(fulfillments, eq(fulfillments.id, fulfillmentItems.fulfillmentId))
        .where(eq(fulfillmentItems.orderItemId, row.item.id));
      const shipped = outbound
        .filter((entry) => entry.status === "shipped" || entry.status === "delivered")
        .reduce((sum, entry) => sum + entry.quantity, 0);
      if (shipped < row.item.quantity) physicalDone = false;
    }
  }
  const started =
    (await ctx.tx.select({ id: fulfillments.id }).from(fulfillments).where(eq(fulfillments.orderId, orderId)).limit(1))
      .length > 0 || grants.length > 0;
  const next =
    physicalDone && digitalDone ? "fulfilled" : started || order.status === "fulfilling" ? "fulfilling" : order.status;
  if (next !== order.status) {
    const [updated] = await ctx.tx
      .update(orders)
      .set({ status: next, updatedAt: sql`now()` })
      .where(eq(orders.id, orderId))
      .returning();
    return updated!;
  }
  return order;
}

async function consumeOutbound(
  ctx: ServiceContext,
  input: { orderId: string; variantId: string; locationId: string | null; quantity: number },
) {
  if (!input.locationId) return;
  const holds = await ctx.tx
    .select()
    .from(stockReservations)
    .where(
      and(
        eq(stockReservations.holderType, "order"),
        eq(stockReservations.holderId, input.orderId),
        eq(stockReservations.status, "active"),
      ),
    );
  const [item] = await ctx.tx
    .select()
    .from(inventoryItems)
    .where(and(eq(inventoryItems.variantId, input.variantId), eq(inventoryItems.locationId, input.locationId)))
    .limit(1);
  const hold = holds.find((row) => row.inventoryItemId === item?.id);
  if (hold && hold.quantity === input.quantity) {
    await ctx.callAsSystem(consumeReservation, { id: hold.id, note: "Shipped." });
    return;
  }
  if (hold && hold.quantity > input.quantity) {
    await ctx.callAsSystem(releaseReservation, { id: hold.id });
    await ctx.callAsSystem(recordStockMovement, {
      itemId: hold.inventoryItemId,
      delta: -input.quantity,
      reason: "sale",
      note: "Partial shipment.",
      referenceType: "order",
      referenceId: input.orderId,
    });
    await ctx.callAsSystem(reserveStock, {
      variantId: input.variantId,
      locationId: input.locationId,
      quantity: hold.quantity - input.quantity,
      holderType: "order",
      holderId: input.orderId,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });
    return;
  }
  if (item) {
    await ctx.callAsSystem(recordStockMovement, {
      itemId: item.id,
      delta: -input.quantity,
      reason: "sale",
      note: "Shipped without an active hold.",
      referenceType: "order",
      referenceId: input.orderId,
    });
  }
}

export const createFulfillment = defineService({
  name: "catalog.createFulfillment",
  summary: "Open a physical shipment for part or all of a paid order.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    orderId: id,
    locationId: id.optional(),
    items: z.array(z.object({ orderItemId: id, quantity: z.number().int().min(1).max(1_000_000) })).min(1),
  }),
  output: fulfillmentDetail,
  handler: async (input, ctx) => {
    const [order] = await ctx.tx.select().from(orders).where(eq(orders.id, input.orderId)).for("update");
    if (!order) throw new ServiceError("not_found", "That order is not here.");
    if (order.status !== "paid" && order.status !== "fulfilling") {
      throw new ServiceError("conflict", "Only a paid order can be fulfilled.");
    }
    for (const line of input.items) {
      const [item] = await ctx.tx
        .select({ item: orderItems, requiresShipping: productVariants.requiresShipping })
        .from(orderItems)
        .innerJoin(productVariants, eq(productVariants.id, orderItems.variantId))
        .where(and(eq(orderItems.id, line.orderItemId), eq(orderItems.orderId, order.id)))
        .limit(1);
      if (!item) throw new ServiceError("not_found", "That order line is not here.");
      if (!item.requiresShipping) {
        throw new ServiceError("validation", "Digital and service lines do not go on a physical shipment.");
      }
      const used = await allocatedQty(ctx.tx, line.orderItemId);
      if (used + line.quantity > item.item.quantity) {
        throw new ServiceError("validation", "That quantity is already on another shipment.");
      }
    }
    const [row] = await ctx.tx
      .insert(fulfillments)
      .values({ orderId: order.id, locationId: input.locationId ?? null, kind: "physical" })
      .returning();
    for (const line of input.items) {
      await ctx.tx.insert(fulfillmentItems).values({
        fulfillmentId: row!.id,
        orderItemId: line.orderItemId,
        quantity: line.quantity,
      });
    }
    await refreshOrderStatus(ctx, order.id);
    ctx.setSubject("fulfillment", row!.id);
    ctx.queueEvent("catalog.fulfillmentCreated", { fulfillmentId: row!.id, orderId: order.id });
    return ctx.call(getFulfillment, { id: row!.id });
  },
});

export const getFulfillment = defineService({
  name: "catalog.getFulfillment",
  summary: "One shipment and its lines.",
  kind: "query",
  permission: "scoped",
  input: z.object({ id }),
  output: fulfillmentDetail,
  handler: async (input, ctx) => {
    const [row] = await ctx.tx.select().from(fulfillments).where(eq(fulfillments.id, input.id)).limit(1);
    if (!row) throw new ServiceError("not_found", "That shipment is not here.");
    const items = await ctx.tx.select().from(fulfillmentItems).where(eq(fulfillmentItems.fulfillmentId, row.id));
    return { fulfillment: row, items };
  },
});

export const listFulfillments = defineService({
  name: "catalog.listFulfillments",
  summary: "Shipments for one order or the owner queue.",
  kind: "query",
  permission: "scoped",
  input: z.object({
    orderId: id.optional(),
    status: z.enum(["pending", "picking", "packed", "shipped", "delivered", "failed", "returned"]).optional(),
  }),
  output: listed(fulfillmentRow),
  handler: (input, ctx) => {
    const filters = [
      input.orderId ? eq(fulfillments.orderId, input.orderId) : undefined,
      input.status ? eq(fulfillments.status, input.status) : undefined,
    ].filter((value): value is NonNullable<typeof value> => Boolean(value));
    return ctx.tx
      .select()
      .from(fulfillments)
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(desc(fulfillments.createdAt))
      .limit(200);
  },
});

export const packFulfillment = defineService({
  name: "catalog.packFulfillment",
  summary: "Mark a pending shipment packed.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({ id, boxId: id.optional(), weightG: z.number().int().min(0).optional() }),
  output: fulfillmentDetail,
  handler: async (input, ctx) => {
    const [row] = await ctx.tx.select().from(fulfillments).where(eq(fulfillments.id, input.id)).for("update");
    if (!row) throw new ServiceError("not_found", "That shipment is not here.");
    if (row.status !== "pending" && row.status !== "picking") {
      throw new ServiceError("conflict", "Only an open shipment can be packed.");
    }
    await ctx.tx
      .update(fulfillments)
      .set({
        status: "packed",
        boxId: input.boxId ?? row.boxId,
        weightG: input.weightG ?? row.weightG,
        updatedAt: sql`now()`,
      })
      .where(eq(fulfillments.id, row.id));
    return ctx.call(getFulfillment, { id: row.id });
  },
});

export const shipFulfillment = defineService({
  name: "catalog.shipFulfillment",
  summary: "Mark a shipment sent, write the sale movement and notify the contact.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    id,
    carrier: z.string().trim().min(1).max(80).optional(),
    service: z.string().trim().min(1).max(80).optional(),
    trackingNumber: z.string().trim().min(1).max(120).optional(),
    trackingUrl: z.string().trim().url().max(500).optional(),
  }),
  output: fulfillmentDetail,
  handler: async (input, ctx) => {
    const [row] = await ctx.tx.select().from(fulfillments).where(eq(fulfillments.id, input.id)).for("update");
    if (!row) throw new ServiceError("not_found", "That shipment is not here.");
    if (row.kind !== "physical") throw new ServiceError("conflict", "A digital grant is not shipped.");
    if (!["pending", "picking", "packed"].includes(row.status)) {
      throw new ServiceError("conflict", "Only an unsent shipment can be marked shipped.");
    }
    const [order] = await ctx.tx.select().from(orders).where(eq(orders.id, row.orderId)).limit(1).for("update");
    if (!order) throw new ServiceError("not_found", "That order is not here.");
    const items = await ctx.tx.select().from(fulfillmentItems).where(eq(fulfillmentItems.fulfillmentId, row.id));
    for (const line of items) {
      const [orderLine] = await ctx.tx.select().from(orderItems).where(eq(orderItems.id, line.orderItemId)).limit(1);
      if (!orderLine) continue;
      await consumeOutbound(ctx, {
        orderId: order.id,
        variantId: orderLine.variantId,
        locationId: row.locationId,
        quantity: line.quantity,
      });
    }
    await ctx.tx
      .update(fulfillments)
      .set({
        status: "shipped",
        carrier: input.carrier ?? row.carrier,
        service: input.service ?? row.service,
        trackingNumber: input.trackingNumber ?? row.trackingNumber,
        trackingUrl: input.trackingUrl ?? row.trackingUrl,
        shippedAt: new Date(),
        updatedAt: sql`now()`,
      })
      .where(eq(fulfillments.id, row.id));
    await refreshOrderStatus(ctx, order.id);
    await ctx.emitTimeline({
      contactId: order.contactId,
      eventType: "order.shipped",
      subjectType: "fulfillment",
      subjectId: row.id,
      payload: { orderId: order.id, trackingNumber: input.trackingNumber ?? row.trackingNumber },
    });
    await notifyCommerceContact(ctx,order.contactId,"order.shipped",`order-shipped:${row.id}`);
    ctx.setSubject("fulfillment", row.id);
    ctx.queueEvent("catalog.fulfillmentShipped", { fulfillmentId: row.id, orderId: order.id });
    return ctx.call(getFulfillment, { id: row.id });
  },
});

export const deliverFulfillment = defineService({
  name: "catalog.deliverFulfillment",
  summary: "Mark a shipped carton delivered.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({ id }),
  output: fulfillmentDetail,
  handler: async (input, ctx) => {
    const [row] = await ctx.tx.select().from(fulfillments).where(eq(fulfillments.id, input.id)).for("update");
    if (!row) throw new ServiceError("not_found", "That shipment is not here.");
    if (row.status !== "shipped") throw new ServiceError("conflict", "Only a shipped carton can be marked delivered.");
    const [order] = await ctx.tx.select().from(orders).where(eq(orders.id, row.orderId)).limit(1);
    await ctx.tx
      .update(fulfillments)
      .set({ status: "delivered", deliveredAt: new Date(), updatedAt: sql`now()` })
      .where(eq(fulfillments.id, row.id));
    if (order) {
      await refreshOrderStatus(ctx, order.id);
      await ctx.emitTimeline({
        contactId: order.contactId,
        eventType: "order.delivered",
        subjectType: "fulfillment",
        subjectId: row.id,
        payload: { orderId: order.id },
      });
      await notifyCommerceContact(ctx,order.contactId,"order.delivered",`order-delivered:${row.id}`);
    }
    ctx.queueEvent("catalog.fulfillmentDelivered", { fulfillmentId: row.id });
    return ctx.call(getFulfillment, { id: row.id });
  },
});

export const failFulfillment = defineService({
  name: "catalog.failFulfillment",
  summary: "Mark a shipment failed so its quantity can be packed again.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({ id, note: z.string().trim().min(3).max(500) }),
  output: fulfillmentDetail,
  handler: async (input, ctx) => {
    const [row] = await ctx.tx.select().from(fulfillments).where(eq(fulfillments.id, input.id)).for("update");
    if (!row) throw new ServiceError("not_found", "That shipment is not here.");
    if (row.status === "delivered" || row.status === "failed" || row.status === "returned") {
      throw new ServiceError("conflict", "That shipment can no longer fail.");
    }
    await ctx.tx
      .update(fulfillments)
      .set({ status: "failed", note: input.note, updatedAt: sql`now()` })
      .where(eq(fulfillments.id, row.id));
    await refreshOrderStatus(ctx, row.orderId);
    ctx.queueEvent("catalog.fulfillmentFailed", { fulfillmentId: row.id });
    return ctx.call(getFulfillment, { id: row.id });
  },
});

export const grantDigitalFulfillment = defineService({
  name: "catalog.grantDigitalFulfillment",
  summary: "Grant download access for every non-shipping line on a paid order.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({ orderId: id }),
  output: z.object({ grants: listed(digitalDeliveryRow) }),
  handler: async (input, ctx) => {
    const [order] = await ctx.tx.select().from(orders).where(eq(orders.id, input.orderId)).for("update");
    if (!order) throw new ServiceError("not_found", "That order is not here.");
    if (order.status === "pending_payment" || order.status === "partially_paid" || order.status === "cancelled") {
      throw new ServiceError("conflict", "That order is not paid.");
    }
    const lines = await ctx.tx
      .select({ item: orderItems, requiresShipping: productVariants.requiresShipping, productId: productVariants.productId })
      .from(orderItems)
      .innerJoin(productVariants, eq(productVariants.id, orderItems.variantId))
      .where(eq(orderItems.orderId, order.id));
    const digital = lines.filter((row) => !row.requiresShipping);
    const created = [];
    for (const row of digital) {
      const [existing] = await ctx.tx
        .select()
        .from(digitalDeliveries)
        .where(eq(digitalDeliveries.orderItemId, row.item.id))
        .limit(1);
      if (existing) {
        created.push(existing);
        continue;
      }
      const [media] = await ctx.tx
        .select({ assetId: productMedia.assetId })
        .from(productMedia)
        .where(eq(productMedia.productId, row.productId))
        .orderBy(asc(productMedia.position))
        .limit(1);
      const [grant] = await ctx.tx
        .insert(digitalDeliveries)
        .values({
          orderId: order.id,
          orderItemId: row.item.id,
          token: crypto.randomUUID(),
          assetId: media?.assetId ?? null,
        })
        .returning();
      created.push(grant!);
    }
    if (digital.length) {
      const [existingShip] = await ctx.tx
        .select()
        .from(fulfillments)
        .where(and(eq(fulfillments.orderId, order.id), eq(fulfillments.kind, "digital")))
        .limit(1);
      if (!existingShip) {
        await ctx.tx.insert(fulfillments).values({
          orderId: order.id,
          kind: "digital",
          status: "delivered",
          deliveredAt: new Date(),
        });
      }
      await ctx.emitTimeline({
        contactId: order.contactId,
        eventType: "order.digitalGranted",
        subjectType: "order",
        subjectId: order.id,
        payload: { grants: created.length },
      });
      await notifyCommerceContact(ctx,order.contactId,"order.digital_granted",`order-digital:${order.id}`);
    }
    await refreshOrderStatus(ctx, order.id);
    return { grants: created };
  },
});

export const listDigitalDeliveries = defineService({
  name: "catalog.listDigitalDeliveries",
  summary: "Download grants for one order.",
  kind: "query",
  permission: "scoped",
  input: z.object({ orderId: id }),
  output: listed(digitalDeliveryRow),
  handler: (input, ctx) =>
    ctx.tx.select().from(digitalDeliveries).where(eq(digitalDeliveries.orderId, input.orderId)),
});

export const requestReturn = defineService({
  name: "catalog.requestReturn",
  summary: "Open an RMA against a paid or fulfilled order.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    orderId: id,
    reason: z.string().trim().min(3).max(1_000),
    restock: z.boolean().default(true),
    items: z.array(z.object({ orderItemId: id, quantity: z.number().int().min(1).max(1_000_000) })).min(1),
  }),
  output: returnDetail,
  handler: async (input, ctx) => {
    const [order] = await ctx.tx.select().from(orders).where(eq(orders.id, input.orderId)).limit(1).for("update");
    if (!order) throw new ServiceError("not_found", "That order is not here.");
    if (!["paid", "fulfilling", "fulfilled"].includes(order.status)) {
      throw new ServiceError("conflict", "Only a paid order can be returned.");
    }
    if (new Set(input.items.map(line=>line.orderItemId)).size!==input.items.length) throw new ServiceError("validation","Choose each returned order line only once.");
    const existing = await ctx.tx.select({orderItemId:returnItems.orderItemId,quantity:returnItems.quantity}).from(returnItems)
      .innerJoin(returnRequests,eq(returnRequests.id,returnItems.returnId))
      .where(and(eq(returnRequests.orderId,order.id),ne(returnRequests.status,"rejected")));
    for (const line of input.items) {
      const [item] = await ctx.tx
        .select()
        .from(orderItems)
        .where(and(eq(orderItems.id, line.orderItemId), eq(orderItems.orderId, order.id)))
        .limit(1);
      if (!item) throw new ServiceError("not_found", "That order line is not here.");
      const previous = existing.filter(entry=>entry.orderItemId===item.id).reduce((total,entry)=>total+entry.quantity,0);
      if (previous + line.quantity > item.quantity) {
        throw new ServiceError("validation", "A return cannot exceed the ordered quantity.");
      }
    }
    const [row] = await ctx.tx
      .insert(returnRequests)
      .values({
        orderId: order.id,
        contactId: order.contactId,
        reason: input.reason,
        restock: input.restock,
      })
      .returning();
    for (const line of input.items) {
      await ctx.tx.insert(returnItems).values({
        returnId: row!.id,
        orderItemId: line.orderItemId,
        quantity: line.quantity,
      });
    }
    ctx.setSubject("return", row!.id);
    ctx.queueEvent("catalog.returnRequested", { returnId: row!.id, orderId: order.id });
    await ctx.emitTimeline({
      contactId: order.contactId,
      eventType: "return.requested",
      subjectType: "return",
      subjectId: row!.id,
      payload: { orderId: order.id },
    });
    return ctx.call(getReturn, { id: row!.id });
  },
});

export const getReturn = defineService({
  name: "catalog.getReturn",
  summary: "One return and its lines.",
  kind: "query",
  permission: "scoped",
  input: z.object({ id }),
  output: returnDetail,
  handler: async (input, ctx) => {
    const [row] = await ctx.tx.select().from(returnRequests).where(eq(returnRequests.id, input.id)).limit(1);
    if (!row) throw new ServiceError("not_found", "That return is not here.");
    const items = await ctx.tx.select().from(returnItems).where(eq(returnItems.returnId, row.id));
    const bank = row.status === "refunded" ? await ctx.callAsSystem(legacyReturnBankPlan, { id: row.id }) : null;
    return { return: bank?.participating && bank.needsReview ? { ...row, status: "received" as const } : row, items };
  },
});

export const listReturns = defineService({
  name: "catalog.listReturns",
  summary: "Returns for one order or the owner queue.",
  kind: "query",
  permission: "scoped",
  input: z.object({
    orderId: id.optional(),
    status: z.enum(["requested", "approved", "received", "refunded", "rejected"]).optional(),
  }),
  output: listed(returnRequestRow),
  handler: async (input, ctx) => {
    const filters = [
      input.orderId ? eq(returnRequests.orderId, input.orderId) : undefined,
      input.status ? input.status === "received" ? or(eq(returnRequests.status,"received"),eq(returnRequests.status,"refunded")) : eq(returnRequests.status, input.status) : undefined,
    ].filter((value): value is NonNullable<typeof value> => Boolean(value));
    const rows = await ctx.tx.select().from(returnRequests).where(filters.length ? and(...filters) : undefined).orderBy(desc(returnRequests.createdAt)).limit(200);
    const result = [];
    for (const row of rows) {
      const bank = row.status === "refunded" ? await ctx.callAsSystem(legacyReturnBankPlan, { id: row.id }) : null;
      const current = bank?.participating && bank.needsReview ? { ...row, status: "received" as const } : row;
      if (!input.status || current.status === input.status) result.push(current);
    }
    return result;
  },
});

export const decideReturn = defineService({
  name: "catalog.decideReturn",
  summary: "Approve or reject a requested return.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    id,
    decision: z.enum(["approved", "rejected"]),
    labelUrl: z.string().trim().url().max(500).refine(value=>{try{const url=new URL(value);return ["https:","http:"].includes(url.protocol)&&!url.username&&!url.password;}catch{return false;}},"Use an HTTP(S) return label address without embedded credentials.").optional(),
  }),
  output: returnDetail,
  handler: async (input, ctx) => {
    const [row] = await ctx.tx.select().from(returnRequests).where(eq(returnRequests.id, input.id)).for("update");
    if (!row) throw new ServiceError("not_found", "That return is not here.");
    if (row.status !== "requested") throw new ServiceError("conflict", "Only a requested return can be decided.");
    await ctx.tx
      .update(returnRequests)
      .set({
        status: input.decision,
        labelUrl: input.labelUrl ?? row.labelUrl,
        updatedAt: sql`now()`,
      })
      .where(eq(returnRequests.id, row.id));
    await ctx.emitTimeline({
      contactId: row.contactId,
      eventType: input.decision === "approved" ? "return.approved" : "return.rejected",
      subjectType: "return",
      subjectId: row.id,
      payload: { orderId: row.orderId },
    });
    await notifyCommerceContact(ctx,row.contactId,input.decision === "approved" ? "return.approved" : "return.rejected",`return-decision:${row.id}`);
    ctx.queueEvent("catalog.returnDecided", { returnId: row.id, decision: input.decision });
    return ctx.call(getReturn, { id: row.id });
  },
});

export const receiveReturn = defineService({
  name: "catalog.receiveReturn",
  summary: "Receive returned units and restock them when the RMA says to.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({ id, locationId: id.optional(), restock:z.boolean().optional() }),
  output: returnDetail,
  handler: async (input, ctx) => {
    const [source] = await ctx.tx.select().from(returnRequests).where(eq(returnRequests.id,input.id));
    if (!source) throw new ServiceError("not_found", "That return is not here.");
    // Serialize separate received RMAs against the same shipped-unit budget.
    await ctx.tx.select({id:orders.id}).from(orders).where(eq(orders.id,source.orderId)).for("update");
    const [row] = await ctx.tx.select().from(returnRequests).where(eq(returnRequests.id,input.id)).for("update");
    if (!row) throw new ServiceError("not_found", "That return is not here.");
    if (row.status !== "approved") throw new ServiceError("conflict", "Only an approved return can be received.");
    const items = await ctx.tx.select().from(returnItems).where(eq(returnItems.returnId, row.id));
    const shouldRestock=input.restock??row.restock;
    if (shouldRestock) {
      for (const line of items) {
        const [orderLine] = await ctx.tx.select().from(orderItems).where(eq(orderItems.id, line.orderItemId)).limit(1);
        if (!orderLine) continue;
        const outbound=await ctx.tx.select({quantity:fulfillmentItems.quantity}).from(fulfillmentItems)
          .innerJoin(fulfillments,eq(fulfillments.id,fulfillmentItems.fulfillmentId))
          .where(and(eq(fulfillmentItems.orderItemId,orderLine.id),eq(fulfillments.kind,"physical"),inArray(fulfillments.status,["shipped","delivered","returned"])));
        const prior=await ctx.tx.select({quantity:returnItems.restockedQuantity}).from(returnItems).where(eq(returnItems.orderItemId,orderLine.id));
        const restockQuantity=Math.min(line.quantity,Math.max(0,outbound.reduce((n,item)=>n+item.quantity,0)-prior.reduce((n,item)=>n+item.quantity,0)));
        // A paid but unshipped unit never left the shelf and cannot add stock.
        if(!restockQuantity) continue;
        const [item] = await ctx.tx
          .select()
          .from(inventoryItems)
          .where(
            and(
              eq(inventoryItems.variantId, orderLine.variantId),
              ...(input.locationId ? [eq(inventoryItems.locationId, input.locationId)] : []),
            ),
          )
          .limit(1);
        if (!item) continue;
        await ctx.callAsSystem(recordStockMovement, {
          itemId: item.id,
          delta: restockQuantity,
          reason: "return",
          note: "RMA received.",
          referenceType: "return",
          referenceId: row.id,
        });
        await ctx.tx
          .update(returnItems)
          .set({ restockedQuantity: restockQuantity })
          .where(eq(returnItems.id, line.id));
      }
    }
    await ctx.tx.update(returnRequests).set({ status: "received", restock:shouldRestock, updatedAt: sql`now()` }).where(eq(returnRequests.id, row.id));
    await ctx.emitTimeline({
      contactId: row.contactId,
      eventType: "return.received",
      subjectType: "return",
      subjectId: row.id,
      payload: { orderId: row.orderId, restock:shouldRestock },
    });
    ctx.queueEvent("catalog.returnReceived", { returnId: row.id });
    return ctx.call(getReturn, { id: row.id });
  },
});

export const listFulfillmentQueue = defineService({
  name: "catalog.listFulfillmentQueue",
  summary: "Paid and in-progress orders that still need a shipment or exception work.",
  kind: "query",
  permission: "scoped",
  input: z.object({}),
  output: listed(orderRow),
  handler: (_input, ctx) =>
    ctx.tx
      .select()
      .from(orders)
      .where(inArray(orders.status, ["paid", "fulfilling"]))
      .orderBy(desc(orders.updatedAt))
      .limit(200),
});

export default [
  createFulfillment,
  getFulfillment,
  listFulfillments,
  packFulfillment,
  shipFulfillment,
  deliverFulfillment,
  failFulfillment,
  grantDigitalFulfillment,
  listDigitalDeliveries,
  requestReturn,
  getReturn,
  listReturns,
  decideReturn,
  receiveReturn,
  ...refundServices,
  listFulfillmentQueue,
];
