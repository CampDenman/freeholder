// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Reorder, suppliers, purchase orders and backorders (C5.17).
//
// Incoming is a stored counter on the inventory item because a PO that has
// been placed but not received is not a stock movement. Receiving writes a
// receipt movement and lowers incoming in the same transaction.

import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { listed, row, timestamp, uuid } from "@/core/contract";
import { contacts } from "@/core/contacts/schema";
import { registerContactReference } from "@/core/contacts/service";
import { registerContactPrivacySource } from "@/core/privacy/service";
import { decimalToMinor } from "@/adapters/payments/currency";
import { defineService, ServiceError, type Tx } from "@/core/service";
import { BACKORDER_POLICIES, PURCHASE_ORDER_STATUSES } from "./contract";
import { bumpIncoming, enableInventory, listInventory, recordStockMovement } from "./inventory";
import {
  backInStockSubscriptions,
  inventoryItems,
  productVariants,
  purchaseOrderLines,
  purchaseOrders,
  suppliers,
} from "./schema";

const id = z.string().uuid();
const currency = z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/);

const inventoryItemRow = row({
  id: uuid,
  variantId: uuid,
  locationId: uuid,
  bin: z.string().nullable(),
  safetyStock: z.number().int(),
  reorderPoint: z.number().int(),
  incoming: z.number().int(),
  createdAt: timestamp,
  updatedAt: timestamp,
});
const inventoryListRow = inventoryItemRow.extend({
  sku: z.string(),
  productName: z.string(),
  locationName: z.string(),
  isPrimary: z.boolean(),
  onHand: z.number().int(),
  reserved: z.number().int(),
  incoming: z.number().int(),
  available: z.number().int(),
});
const variantRow = row({
  id: uuid,
  productId: uuid,
  combinationKey: z.string(),
  sku: z.string(),
  isDefault: z.boolean(),
  status: z.enum(["active", "archived"]),
  backorderPolicy: z.enum(BACKORDER_POLICIES),
  expectedRestockAt: timestamp.nullable(),
  requiresShipping: z.boolean(),
  weightG: z.number().int().nullable(),
  lengthMm: z.number().int().nullable(),
  widthMm: z.number().int().nullable(),
  heightMm: z.number().int().nullable(),
  createdAt: timestamp,
  updatedAt: timestamp,
});
const supplierRow = row({
  id: uuid,
  name: z.string(),
  contactId: uuid.nullable(),
  leadTimeDays: z.number().int(),
  currency: z.string(),
  createdAt: timestamp,
  updatedAt: timestamp,
});
const purchaseOrderRow = row({
  id: uuid,
  supplierId: uuid,
  locationId: uuid,
  status: z.enum(PURCHASE_ORDER_STATUSES),
  currency: z.string(),
  expectedAt: timestamp.nullable(),
  createdAt: timestamp,
  updatedAt: timestamp,
});
const purchaseOrderLineRow = row({
  id: uuid,
  purchaseOrderId: uuid,
  variantId: uuid,
  quantity: z.number().int(),
  receivedQty: z.number().int(),
  unitCostMinor: z.number().int(),
  createdAt: timestamp,
  updatedAt: timestamp,
});
const backInStockRow = row({
  id: uuid,
  variantId: uuid,
  contactId: uuid,
  locationId: uuid.nullable(),
  notifiedAt: timestamp.nullable(),
  createdAt: timestamp,
});

registerContactReference({
  table: "suppliers",
  repoint: (tx, from, to) =>
    tx.update(suppliers).set({ contactId: to }).where(eq(suppliers.contactId, from)),
  captureForUndo: async (tx, duplicateId, survivingId) => ({
    state: await tx
      .select({ id: suppliers.id, contactId: suppliers.contactId })
      .from(suppliers)
      .where(inArray(suppliers.contactId, [duplicateId, survivingId])),
    undoable: true,
  }),
  restoreAfterUndo: async (tx, beforeState, afterState, duplicateId) => {
    const schema = z.array(z.object({ id: z.string().uuid(), contactId: z.string().uuid().nullable() }));
    const before = schema.parse(beforeState);
    const after = schema.parse(afterState);
    const current = after.length
      ? await tx
          .select({ id: suppliers.id, contactId: suppliers.contactId })
          .from(suppliers)
          .where(inArray(suppliers.id, after.map((row) => row.id)))
      : [];
    const currentById = new Map(current.map((row) => [row.id, row.contactId]));
    if (current.length !== after.length || after.some((row) => currentById.get(row.id) !== row.contactId)) {
      throw new ServiceError(
        "conflict",
        "A supplier changed after this merge. Leave the merge in place or restore that supplier first.",
      );
    }
    const movedIds = before.filter((row) => row.contactId === duplicateId).map((row) => row.id);
    if (movedIds.length) {
      await tx.update(suppliers).set({ contactId: duplicateId }).where(inArray(suppliers.id, movedIds));
    }
  },
});

registerContactReference({
  table: "back_in_stock_subscriptions",
  repoint: (tx, from, to) =>
    tx
      .update(backInStockSubscriptions)
      .set({ contactId: to })
      .where(eq(backInStockSubscriptions.contactId, from)),
  captureForUndo: async (tx, duplicateId, survivingId) => ({
    state: await tx
      .select({
        id: backInStockSubscriptions.id,
        contactId: backInStockSubscriptions.contactId,
      })
      .from(backInStockSubscriptions)
      .where(inArray(backInStockSubscriptions.contactId, [duplicateId, survivingId])),
    undoable: true,
  }),
  restoreAfterUndo: async (tx, beforeState, afterState, duplicateId) => {
    const schema = z.array(z.object({ id: z.string().uuid(), contactId: z.string().uuid() }));
    const before = schema.parse(beforeState);
    const after = schema.parse(afterState);
    const current = after.length
      ? await tx
          .select({
            id: backInStockSubscriptions.id,
            contactId: backInStockSubscriptions.contactId,
          })
          .from(backInStockSubscriptions)
          .where(inArray(backInStockSubscriptions.id, after.map((row) => row.id)))
      : [];
    const currentById = new Map(current.map((row) => [row.id, row.contactId]));
    if (current.length !== after.length || after.some((row) => currentById.get(row.id) !== row.contactId)) {
      throw new ServiceError(
        "conflict",
        "A back-in-stock subscription changed after this merge.",
      );
    }
    const movedIds = before.filter((row) => row.contactId === duplicateId).map((row) => row.id);
    if (movedIds.length) {
      await tx
        .update(backInStockSubscriptions)
        .set({ contactId: duplicateId })
        .where(inArray(backInStockSubscriptions.id, movedIds));
    }
  },
});

registerContactPrivacySource({
  scope: "catalog.suppliers",
  tables: ["suppliers"],
  exportData: async (tx: Tx, contactId: string) =>
    tx
      .select({ id: suppliers.id, name: suppliers.name, currency: suppliers.currency })
      .from(suppliers)
      .where(eq(suppliers.contactId, contactId)),
  erase: async (tx: Tx, contactId: string) => {
    const rows = await tx
      .update(suppliers)
      .set({ contactId: null, name: "Supplier (erased)" })
      .where(eq(suppliers.contactId, contactId))
      .returning({ id: suppliers.id });
    return { affected: rows.length };
  },
});

registerContactPrivacySource({
  scope: "catalog.back_in_stock",
  tables: ["back_in_stock_subscriptions"],
  exportData: async (tx: Tx, contactId: string) =>
    tx
      .select({
        id: backInStockSubscriptions.id,
        variantId: backInStockSubscriptions.variantId,
        notifiedAt: backInStockSubscriptions.notifiedAt,
      })
      .from(backInStockSubscriptions)
      .where(eq(backInStockSubscriptions.contactId, contactId)),
  erase: async (tx: Tx, contactId: string) => {
    const rows = await tx
      .delete(backInStockSubscriptions)
      .where(eq(backInStockSubscriptions.contactId, contactId))
      .returning({ id: backInStockSubscriptions.id });
    return { affected: rows.length };
  },
});

async function requireContact(tx: Tx, contactId: string) {
  const [row] = await tx.select({ id: contacts.id }).from(contacts).where(eq(contacts.id, contactId)).limit(1);
  if (!row) throw new ServiceError("not_found", "That contact is not here.");
}

export const setInventoryLevels = defineService({
  name: "catalog.setInventoryLevels",
  summary: "Set safety stock, reorder point and bin on a tracked item.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    itemId: id,
    safetyStock: z.number().int().min(0).max(1_000_000),
    reorderPoint: z.number().int().min(0).max(1_000_000),
    bin: z.string().trim().min(1).max(40).nullable().optional(),
  }),
  output: inventoryItemRow,
  handler: async (input, ctx) => {
    const [item] = await ctx.tx
      .update(inventoryItems)
      .set({
        safetyStock: input.safetyStock,
        reorderPoint: input.reorderPoint,
        ...(input.bin !== undefined ? { bin: input.bin } : {}),
        updatedAt: sql`now()`,
      })
      .where(eq(inventoryItems.id, input.itemId))
      .returning();
    if (!item) throw new ServiceError("not_found", "That inventory item is not here.");
    ctx.setSubject("inventoryItem", item.id);
    return item;
  },
});

export const setVariantStockPolicy = defineService({
  name: "catalog.setVariantStockPolicy",
  summary: "Set backorder policy and expected restock date on a variant.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    variantId: id,
    backorderPolicy: z.enum(BACKORDER_POLICIES),
    expectedRestockAt: z.coerce.date().nullable().optional(),
  }),
  output: variantRow,
  handler: async (input, ctx) => {
    if (input.backorderPolicy === "allow_date" && !input.expectedRestockAt) {
      throw new ServiceError("validation", "A dated backorder needs an expected restock date.");
    }
    const [row] = await ctx.tx
      .update(productVariants)
      .set({
        backorderPolicy: input.backorderPolicy,
        expectedRestockAt: input.backorderPolicy === "allow_date" ? input.expectedRestockAt : null,
        updatedAt: sql`now()`,
      })
      .where(eq(productVariants.id, input.variantId))
      .returning();
    if (!row) throw new ServiceError("not_found", "That variant is not here.");
    ctx.setSubject("productVariant", row.id);
    return row;
  },
});

export const listReorderQueue = defineService({
  name: "catalog.listReorderQueue",
  summary: "Tracked items at or below their reorder point, including incoming.",
  kind: "query",
  permission: "scoped",
  input: z.object({}),
  output: listed(inventoryListRow),
  handler: async (_input, ctx) => {
    const rows = await ctx.call(listInventory, {});
    return rows.filter((row) => row.reorderPoint > 0 && row.onHand + row.incoming <= row.reorderPoint);
  },
});

export const listSuppliers = defineService({
  name: "catalog.listSuppliers",
  summary: "Every supplier, newest first.",
  kind: "query",
  permission: "scoped",
  input: z.object({}),
  output: listed(supplierRow),
  handler: (_input, ctx) => ctx.tx.select().from(suppliers).orderBy(asc(suppliers.name)),
});

export const createSupplier = defineService({
  name: "catalog.createSupplier",
  summary: "Add a supplier the catalog can buy from.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    name: z.string().trim().min(1).max(120),
    currency,
    leadTimeDays: z.number().int().min(0).max(365).default(7),
    contactId: id.optional(),
  }),
  output: supplierRow,
  handler: async (input, ctx) => {
    if (input.contactId) await requireContact(ctx.tx, input.contactId);
    const [created] = await ctx.tx.insert(suppliers).values(input).returning();
    ctx.setSubject("supplier", created!.id);
    ctx.queueEvent("catalog.supplierCreated", { supplierId: created!.id });
    return created!;
  },
});

export const createPurchaseOrder = defineService({
  name: "catalog.createPurchaseOrder",
  summary: "Open a draft purchase order against one supplier and location.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    supplierId: id,
    locationId: id,
    expectedAt: z.coerce.date().optional(),
  }),
  output: purchaseOrderRow,
  handler: async (input, ctx) => {
    const [supplier] = await ctx.tx.select().from(suppliers).where(eq(suppliers.id, input.supplierId)).limit(1);
    if (!supplier) throw new ServiceError("not_found", "That supplier is not here.");
    const [created] = await ctx.tx
      .insert(purchaseOrders)
      .values({
        supplierId: supplier.id,
        locationId: input.locationId,
        currency: supplier.currency,
        expectedAt: input.expectedAt ?? null,
      })
      .returning();
    ctx.setSubject("purchaseOrder", created!.id);
    return created!;
  },
});

export const addPurchaseOrderLine = defineService({
  name: "catalog.addPurchaseOrderLine",
  summary: "Add or replace a draft purchase-order line.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    purchaseOrderId: id,
    variantId: id,
    quantity: z.number().int().min(1).max(1_000_000),
    unitCost: z.string().trim(),
  }),
  output: purchaseOrderLineRow,
  handler: async (input, ctx) => {
    const [order] = await ctx.tx
      .select()
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, input.purchaseOrderId))
      .limit(1);
    if (!order) throw new ServiceError("not_found", "That purchase order is not here.");
    if (order.status !== "draft") {
      throw new ServiceError("conflict", "Only a draft purchase order can change lines.");
    }
    const unitCostMinor = decimalToMinor(input.unitCost, order.currency);
    const [line] = await ctx.tx
      .insert(purchaseOrderLines)
      .values({
        purchaseOrderId: order.id,
        variantId: input.variantId,
        quantity: input.quantity,
        unitCostMinor,
      })
      .onConflictDoUpdate({
        target: [purchaseOrderLines.purchaseOrderId, purchaseOrderLines.variantId],
        set: { quantity: input.quantity, unitCostMinor, updatedAt: sql`now()` },
      })
      .returning();
    ctx.setSubject("purchaseOrder", order.id);
    return line!;
  },
});

export const listPurchaseOrders = defineService({
  name: "catalog.listPurchaseOrders",
  summary: "Purchase orders with their lines.",
  kind: "query",
  permission: "scoped",
  input: z.object({ status: z.enum(PURCHASE_ORDER_STATUSES).optional() }),
  output: listed(purchaseOrderRow.extend({ lines: listed(purchaseOrderLineRow) })),
  handler: async (input, ctx) => {
    const orders = await ctx.tx
      .select()
      .from(purchaseOrders)
      .where(input.status ? eq(purchaseOrders.status, input.status) : undefined)
      .orderBy(desc(purchaseOrders.createdAt));
    const lines = orders.length
      ? await ctx.tx
          .select()
          .from(purchaseOrderLines)
          .where(inArray(purchaseOrderLines.purchaseOrderId, orders.map((row) => row.id)))
      : [];
    return orders.map((order) => ({
      ...order,
      lines: lines.filter((line) => line.purchaseOrderId === order.id),
    }));
  },
});

export const placePurchaseOrder = defineService({
  name: "catalog.placePurchaseOrder",
  summary: "Mark a draft PO ordered and add its quantities to incoming stock.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({ id }),
  output: purchaseOrderRow,
  handler: async (input, ctx) => {
    const [order] = await ctx.tx
      .select()
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, input.id))
      .for("update");
    if (!order) throw new ServiceError("not_found", "That purchase order is not here.");
    if (order.status !== "draft") {
      throw new ServiceError("conflict", "Only a draft purchase order can be placed.");
    }
    const lines = await ctx.tx
      .select()
      .from(purchaseOrderLines)
      .where(eq(purchaseOrderLines.purchaseOrderId, order.id));
    if (lines.length === 0) {
      throw new ServiceError("validation", "Add at least one line before placing the order.");
    }
    for (const line of lines) {
      const item = await ctx.call(enableInventory, {
        variantId: line.variantId,
        locationId: order.locationId,
      });
      await bumpIncoming(ctx.tx, item.id, line.quantity);
    }
    const [updated] = await ctx.tx
      .update(purchaseOrders)
      .set({ status: "ordered", updatedAt: sql`now()` })
      .where(eq(purchaseOrders.id, order.id))
      .returning();
    ctx.setSubject("purchaseOrder", order.id);
    ctx.queueEvent("catalog.purchaseOrderPlaced", { purchaseOrderId: order.id });
    return updated!;
  },
});

export const receivePurchaseOrderLine = defineService({
  name: "catalog.receivePurchaseOrderLine",
  summary: "Receive units against an ordered PO line and write a receipt movement.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    lineId: id,
    quantity: z.number().int().min(1).max(1_000_000),
    note: z.string().trim().min(1).max(500).optional(),
  }),
  output: z.object({
    line: purchaseOrderLineRow,
    status: z.enum(PURCHASE_ORDER_STATUSES),
  }),
  handler: async (input, ctx) => {
    const [line] = await ctx.tx
      .select()
      .from(purchaseOrderLines)
      .where(eq(purchaseOrderLines.id, input.lineId))
      .for("update");
    if (!line) throw new ServiceError("not_found", "That purchase-order line is not here.");
    const [order] = await ctx.tx
      .select()
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, line.purchaseOrderId))
      .for("update");
    if (!order || (order.status !== "ordered" && order.status !== "partial")) {
      throw new ServiceError("conflict", "Only an ordered purchase order can be received.");
    }
    const remaining = line.quantity - line.receivedQty;
    if (input.quantity > remaining) {
      throw new ServiceError("validation", "Cannot receive more than the open quantity.");
    }
    const item = await ctx.call(enableInventory, {
      variantId: line.variantId,
      locationId: order.locationId,
    });
    await ctx.call(recordStockMovement, {
      itemId: item.id,
      delta: input.quantity,
      reason: "receipt",
      note: input.note,
      referenceType: "purchase_order",
      referenceId: order.id,
    });
    await bumpIncoming(ctx.tx, item.id, -input.quantity);
    const [updatedLine] = await ctx.tx
      .update(purchaseOrderLines)
      .set({ receivedQty: line.receivedQty + input.quantity, updatedAt: sql`now()` })
      .where(eq(purchaseOrderLines.id, line.id))
      .returning();
    const all = await ctx.tx
      .select()
      .from(purchaseOrderLines)
      .where(eq(purchaseOrderLines.purchaseOrderId, order.id));
    const fullyReceived = all.every((row) => row.receivedQty >= row.quantity);
    const anyReceived = all.some((row) => row.receivedQty > 0);
    const nextStatus = fullyReceived ? "received" : anyReceived ? "partial" : order.status;
    await ctx.tx
      .update(purchaseOrders)
      .set({ status: nextStatus, updatedAt: sql`now()` })
      .where(eq(purchaseOrders.id, order.id));

    const waiting = await ctx.tx
      .select()
      .from(backInStockSubscriptions)
      .where(
        and(
          eq(backInStockSubscriptions.variantId, line.variantId),
          isNull(backInStockSubscriptions.notifiedAt),
        ),
      );
    if (waiting.length) {
      await ctx.tx
        .update(backInStockSubscriptions)
        .set({ notifiedAt: sql`now()` })
        .where(inArray(backInStockSubscriptions.id, waiting.map((row) => row.id)));
      ctx.queueEvent("catalog.backInStock", {
        variantId: line.variantId,
        subscriptionIds: waiting.map((row) => row.id),
      });
    }
    ctx.setSubject("purchaseOrder", order.id);
    ctx.queueEvent("catalog.purchaseOrderReceived", {
      purchaseOrderId: order.id,
      lineId: line.id,
      quantity: input.quantity,
    });
    return { line: updatedLine!, status: nextStatus };
  },
});

export const cancelPurchaseOrder = defineService({
  name: "catalog.cancelPurchaseOrder",
  summary: "Cancel a draft or open PO and reverse remaining incoming stock.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({ id }),
  output: purchaseOrderRow,
  handler: async (input, ctx) => {
    const [order] = await ctx.tx
      .select()
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, input.id))
      .for("update");
    if (!order) throw new ServiceError("not_found", "That purchase order is not here.");
    if (order.status === "received" || order.status === "cancelled") {
      throw new ServiceError("conflict", "That purchase order cannot be cancelled.");
    }
    if (order.status === "ordered" || order.status === "partial") {
      const lines = await ctx.tx
        .select()
        .from(purchaseOrderLines)
        .where(eq(purchaseOrderLines.purchaseOrderId, order.id));
      for (const line of lines) {
        const remaining = line.quantity - line.receivedQty;
        if (remaining <= 0) continue;
        const [item] = await ctx.tx
          .select({ id: inventoryItems.id })
          .from(inventoryItems)
          .where(
            and(
              eq(inventoryItems.variantId, line.variantId),
              eq(inventoryItems.locationId, order.locationId),
            ),
          )
          .limit(1);
        if (item) await bumpIncoming(ctx.tx, item.id, -remaining);
      }
    }
    const [updated] = await ctx.tx
      .update(purchaseOrders)
      .set({ status: "cancelled", updatedAt: sql`now()` })
      .where(eq(purchaseOrders.id, order.id))
      .returning();
    ctx.setSubject("purchaseOrder", order.id);
    return updated!;
  },
});

export const subscribeBackInStock = defineService({
  name: "catalog.subscribeBackInStock",
  summary: "Ask to be told when a tracked variant is received again.",
  kind: "mutation",
  permission: "public",
  input: z.object({ variantId: id, contactId: id, locationId: id.optional() }),
  output: backInStockRow,
  handler: async (input, ctx) => {
    await requireContact(ctx.tx, input.contactId);
    const [existing] = await ctx.tx
      .select()
      .from(backInStockSubscriptions)
      .where(
        and(
          eq(backInStockSubscriptions.variantId, input.variantId),
          eq(backInStockSubscriptions.contactId, input.contactId),
          input.locationId
            ? eq(backInStockSubscriptions.locationId, input.locationId)
            : isNull(backInStockSubscriptions.locationId),
        ),
      )
      .limit(1);
    if (existing) {
      if (!existing.notifiedAt) return existing;
      const [reopened] = await ctx.tx
        .update(backInStockSubscriptions)
        .set({ notifiedAt: null })
        .where(eq(backInStockSubscriptions.id, existing.id))
        .returning();
      return reopened!;
    }
    const [created] = await ctx.tx
      .insert(backInStockSubscriptions)
      .values({
        variantId: input.variantId,
        contactId: input.contactId,
        locationId: input.locationId ?? null,
      })
      .returning();
    ctx.setSubject("backInStockSubscription", created!.id);
    return created!;
  },
});

export default [
  setInventoryLevels,
  setVariantStockPolicy,
  listReorderQueue,
  listSuppliers,
  createSupplier,
  createPurchaseOrder,
  addPurchaseOrderLine,
  listPurchaseOrders,
  placePurchaseOrder,
  receivePurchaseOrderLine,
  cancelPurchaseOrder,
  subscribeBackInStock,
];
