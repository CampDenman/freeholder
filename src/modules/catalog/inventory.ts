// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Append-only stock ledger (MASTER.md §4.2, C5.16).
//
// on_hand is the sum of movements. reserved is the sum of unexpired active
// holds. A variant with no inventory row is untracked and is always available.

import { and, asc, desc, eq, gt, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { actorString, defineService, ServiceError, type Tx } from "@/core/service";
import { businessLocations } from "@/core/locations/schema";
import { STOCK_HOLDERS, STOCK_REASONS } from "./contract";
import {
  inventoryItems,
  productVariants,
  products,
  stockMovements,
  stockReservations,
} from "./schema";

const id = z.string().uuid();

export interface StockBalance {
  onHand: number;
  reserved: number;
  incoming: number;
  available: number;
}

function promiseFromPolicy(input: {
  tracked: true;
  onHand: number;
  reserved: number;
  incoming: number;
  canPromise: number;
  quantity: number;
  policy: "refuse" | "allow_date" | "allow_silent";
  restockAt: Date | null;
}) {
  const inStock = input.canPromise >= input.quantity;
  const backordered =
    !inStock &&
    (input.policy === "allow_silent" || (input.policy === "allow_date" && Boolean(input.restockAt)));
  return {
    tracked: true as const,
    available: inStock || backordered,
    backordered,
    restockAt: backordered ? input.restockAt : null,
    onHand: input.onHand,
    reserved: input.reserved,
    incoming: input.incoming,
    canPromise: input.canPromise,
  };
}

function asCount(value: unknown): number {
  const number = typeof value === "bigint" ? Number(value) : Number(value ?? 0);
  if (!Number.isSafeInteger(number)) {
    throw new ServiceError("validation", "Stock totals left the integer range.");
  }
  return number;
}

export async function stockBalance(tx: Tx, itemId: string): Promise<StockBalance> {
  const [moved] = await tx
    .select({
      onHand: sql<number>`coalesce(sum(${stockMovements.delta}), 0)`,
    })
    .from(stockMovements)
    .where(eq(stockMovements.inventoryItemId, itemId));
  const [held] = await tx
    .select({
      reserved: sql<number>`coalesce(sum(${stockReservations.quantity}), 0)`,
    })
    .from(stockReservations)
    .where(
      and(
        eq(stockReservations.inventoryItemId, itemId),
        eq(stockReservations.status, "active"),
        gt(stockReservations.expiresAt, sql`now()`),
      ),
    );
  const [item] = await tx
    .select({ incoming: inventoryItems.incoming })
    .from(inventoryItems)
    .where(eq(inventoryItems.id, itemId))
    .limit(1);
  const onHand = asCount(moved?.onHand);
  const reserved = asCount(held?.reserved);
  return {
    onHand,
    reserved,
    incoming: item?.incoming ?? 0,
    available: onHand - reserved,
  };
}

export async function bumpIncoming(tx: Tx, itemId: string, delta: number): Promise<number> {
  const item = await lockItem(tx, itemId);
  const next = item.incoming + delta;
  if (next < 0) {
    throw new ServiceError("validation", "Incoming stock cannot fall below zero.");
  }
  await tx
    .update(inventoryItems)
    .set({ incoming: next, updatedAt: sql`now()` })
    .where(eq(inventoryItems.id, itemId));
  return next;
}

async function lockItem(tx: Tx, itemId: string) {
  const [item] = await tx
    .select()
    .from(inventoryItems)
    .where(eq(inventoryItems.id, itemId))
    .for("update");
  if (!item) throw new ServiceError("not_found", "That inventory item is not here.");
  return item;
}

async function applyMovement(
  tx: Tx,
  input: {
    itemId: string;
    delta: number;
    reason: (typeof STOCK_REASONS)[number];
    actor: string;
    note?: string | null;
    referenceType?: string | null;
    referenceId?: string | null;
  },
) {
  await lockItem(tx, input.itemId);
  await assertPhysical(tx, input.itemId, input.delta);
  return writeMovement(tx, input);
}

async function writeMovement(
  tx: Tx,
  input: {
    itemId: string;
    delta: number;
    reason: (typeof STOCK_REASONS)[number];
    actor: string;
    note?: string | null;
    referenceType?: string | null;
    referenceId?: string | null;
  },
) {
  if (!Number.isSafeInteger(input.delta) || input.delta === 0) {
    throw new ServiceError("validation", "A stock movement must change a non-zero integer quantity.");
  }
  const [row] = await tx
    .insert(stockMovements)
    .values({
      inventoryItemId: input.itemId,
      delta: input.delta,
      reason: input.reason,
      actor: input.actor,
      note: input.note ?? null,
      referenceType: input.referenceType ?? null,
      referenceId: input.referenceId ?? null,
    })
    .returning();
  return row!;
}

async function assertPhysical(
  tx: Tx,
  itemId: string,
  delta: number,
): Promise<StockBalance> {
  const balance = await stockBalance(tx, itemId);
  const nextOnHand = balance.onHand + delta;
  if (nextOnHand < 0) {
    throw new ServiceError("validation", "There is not enough stock on hand for that movement.");
  }
  if (nextOnHand < balance.reserved) {
    throw new ServiceError(
      "validation",
      "That movement would leave less stock on the shelf than is already reserved.",
    );
  }
  return { ...balance, onHand: nextOnHand, available: nextOnHand - balance.reserved };
}

export const enableInventory = defineService({
  name: "catalog.enableInventory",
  summary: "Start tracking a variant at one location.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    variantId: id,
    locationId: id,
    bin: z.string().trim().min(1).max(40).optional(),
  }),
  handler: async (input, ctx) => {
    const [variant] = await ctx.tx
      .select({ id: productVariants.id, status: productVariants.status })
      .from(productVariants)
      .where(eq(productVariants.id, input.variantId))
      .limit(1);
    if (!variant || variant.status !== "active") {
      throw new ServiceError("not_found", "That variant is not here.");
    }
    const [location] = await ctx.tx
      .select({ id: businessLocations.id })
      .from(businessLocations)
      .where(eq(businessLocations.id, input.locationId))
      .limit(1);
    if (!location) throw new ServiceError("not_found", "That location is not here.");
    const [existing] = await ctx.tx
      .select()
      .from(inventoryItems)
      .where(
        and(
          eq(inventoryItems.variantId, input.variantId),
          eq(inventoryItems.locationId, input.locationId),
        ),
      )
      .limit(1);
    if (existing) return existing;
    const [created] = await ctx.tx
      .insert(inventoryItems)
      .values({
        variantId: input.variantId,
        locationId: input.locationId,
        bin: input.bin ?? null,
      })
      .returning();
    ctx.setSubject("inventoryItem", created!.id);
    ctx.queueEvent("catalog.inventoryEnabled", {
      itemId: created!.id,
      variantId: input.variantId,
      locationId: input.locationId,
    });
    return created!;
  },
});

export const listInventory = defineService({
  name: "catalog.listInventory",
  summary: "Tracked stock balances by variant and location.",
  kind: "query",
  permission: "scoped",
  input: z.object({
    locationId: id.optional(),
    variantId: id.optional(),
  }),
  handler: async (input, ctx) => {
    const filters = [
      input.locationId ? eq(inventoryItems.locationId, input.locationId) : undefined,
      input.variantId ? eq(inventoryItems.variantId, input.variantId) : undefined,
    ].filter((value): value is NonNullable<typeof value> => Boolean(value));
    const rows = await ctx.tx
      .select({
        item: inventoryItems,
        sku: productVariants.sku,
        productName: products.name,
        locationName: businessLocations.name,
        isPrimary: businessLocations.isPrimary,
      })
      .from(inventoryItems)
      .innerJoin(productVariants, eq(productVariants.id, inventoryItems.variantId))
      .innerJoin(products, eq(products.id, productVariants.productId))
      .innerJoin(businessLocations, eq(businessLocations.id, inventoryItems.locationId))
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(asc(products.name), asc(productVariants.sku), desc(businessLocations.isPrimary));
    return Promise.all(
      rows.map(async (row) => ({
        ...row.item,
        sku: row.sku,
        productName: row.productName,
        locationName: row.locationName,
        isPrimary: row.isPrimary,
        ...(await stockBalance(ctx.tx, row.item.id)),
      })),
    );
  },
});

export const listStockMovements = defineService({
  name: "catalog.listStockMovements",
  summary: "Append-only ledger for one inventory item.",
  kind: "query",
  permission: "scoped",
  input: z.object({ itemId: id, limit: z.number().int().min(1).max(200).default(50) }),
  handler: async (input, ctx) => {
    const [item] = await ctx.tx
      .select({ id: inventoryItems.id })
      .from(inventoryItems)
      .where(eq(inventoryItems.id, input.itemId))
      .limit(1);
    if (!item) throw new ServiceError("not_found", "That inventory item is not here.");
    return ctx.tx
      .select()
      .from(stockMovements)
      .where(eq(stockMovements.inventoryItemId, input.itemId))
      .orderBy(desc(stockMovements.createdAt))
      .limit(input.limit);
  },
});

export const recordStockMovement = defineService({
  name: "catalog.recordStockMovement",
  summary: "Append one stock movement and refuse a negative shelf balance.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    itemId: id,
    delta: z.number().int().refine((value) => value !== 0, "A movement must change quantity."),
    reason: z.enum(STOCK_REASONS),
    note: z.string().trim().min(1).max(500).optional(),
    referenceType: z.string().trim().min(1).max(40).optional(),
    referenceId: id.optional(),
  }),
  handler: async (input, ctx) => {
    const movement = await applyMovement(ctx.tx, {
      itemId: input.itemId,
      delta: input.delta,
      reason: input.reason,
      actor: actorString(ctx.actor),
      note: input.note,
      referenceType: input.referenceType,
      referenceId: input.referenceId,
    });
    ctx.setSubject("stockMovement", movement.id);
    ctx.queueEvent("catalog.stockMoved", {
      itemId: input.itemId,
      movementId: movement.id,
      delta: input.delta,
      reason: input.reason,
    });
    return { movement, balance: await stockBalance(ctx.tx, input.itemId) };
  },
});

export const countStock = defineService({
  name: "catalog.countStock",
  summary: "Record a physical count as the delta from current on-hand.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    itemId: id,
    quantity: z.number().int().min(0).max(1_000_000),
    note: z.string().trim().min(1).max(500).optional(),
  }),
  handler: async (input, ctx) => {
    await lockItem(ctx.tx, input.itemId);
    const current = await stockBalance(ctx.tx, input.itemId);
    const delta = input.quantity - current.onHand;
    if (delta === 0) return { movement: null, balance: current };
    if (input.quantity < current.reserved) {
      throw new ServiceError(
        "validation",
        "A count cannot sit below stock that is already reserved.",
      );
    }
    const movement = await writeMovement(ctx.tx, {
      itemId: input.itemId,
      delta,
      reason: "count",
      actor: actorString(ctx.actor),
      note: input.note,
    });
    ctx.setSubject("stockMovement", movement.id);
    ctx.queueEvent("catalog.stockMoved", {
      itemId: input.itemId,
      movementId: movement.id,
      delta,
      reason: "count",
    });
    return { movement, balance: await stockBalance(ctx.tx, input.itemId) };
  },
});

export const adjustStock = defineService({
  name: "catalog.adjustStock",
  summary: "Adjust on-hand stock with a signed integer delta.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    itemId: id,
    delta: z.number().int().refine((value) => value !== 0),
    note: z.string().trim().min(1).max(500),
  }),
  handler: async (input, ctx) => {
    const movement = await applyMovement(ctx.tx, {
      itemId: input.itemId,
      delta: input.delta,
      reason: "adjustment",
      actor: actorString(ctx.actor),
      note: input.note,
    });
    ctx.setSubject("stockMovement", movement.id);
    ctx.queueEvent("catalog.stockMoved", {
      itemId: input.itemId,
      movementId: movement.id,
      delta: input.delta,
      reason: "adjustment",
    });
    return { movement, balance: await stockBalance(ctx.tx, input.itemId) };
  },
});

export const recordDamage = defineService({
  name: "catalog.recordDamage",
  summary: "Write off damaged units from on-hand stock.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    itemId: id,
    quantity: z.number().int().min(1).max(1_000_000),
    note: z.string().trim().min(1).max(500),
  }),
  handler: async (input, ctx) => {
    const movement = await applyMovement(ctx.tx, {
      itemId: input.itemId,
      delta: -input.quantity,
      reason: "damage",
      actor: actorString(ctx.actor),
      note: input.note,
    });
    ctx.setSubject("stockMovement", movement.id);
    ctx.queueEvent("catalog.stockMoved", {
      itemId: input.itemId,
      movementId: movement.id,
      delta: -input.quantity,
      reason: "damage",
    });
    return { movement, balance: await stockBalance(ctx.tx, input.itemId) };
  },
});

export const transferStock = defineService({
  name: "catalog.transferStock",
  summary: "Move stock between two locations in one transaction.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    fromItemId: id,
    toLocationId: id,
    quantity: z.number().int().min(1).max(1_000_000),
    note: z.string().trim().min(1).max(500).optional(),
  }),
  handler: async (input, ctx) => {
    const source = await lockItem(ctx.tx, input.fromItemId);
    if (source.locationId === input.toLocationId) {
      throw new ServiceError("validation", "A transfer needs two different locations.");
    }
    const [location] = await ctx.tx
      .select({ id: businessLocations.id })
      .from(businessLocations)
      .where(eq(businessLocations.id, input.toLocationId))
      .limit(1);
    if (!location) throw new ServiceError("not_found", "That destination location is not here.");

    let [destination] = await ctx.tx
      .select()
      .from(inventoryItems)
      .where(
        and(
          eq(inventoryItems.variantId, source.variantId),
          eq(inventoryItems.locationId, input.toLocationId),
        ),
      )
      .limit(1);
    if (!destination) {
      [destination] = await ctx.tx
        .insert(inventoryItems)
        .values({ variantId: source.variantId, locationId: input.toLocationId })
        .returning();
    }
    const dest = destination!;
    const ordered = [source.id, dest.id].sort();
    for (const itemId of ordered) await lockItem(ctx.tx, itemId);
    await assertPhysical(ctx.tx, source.id, -input.quantity);

    const transferId = crypto.randomUUID();
    const actor = actorString(ctx.actor);
    const outgoing = await writeMovement(ctx.tx, {
      itemId: source.id,
      delta: -input.quantity,
      reason: "transfer",
      actor,
      note: input.note,
      referenceType: "transfer",
      referenceId: transferId,
    });
    const incoming = await writeMovement(ctx.tx, {
      itemId: dest.id,
      delta: input.quantity,
      reason: "transfer",
      actor,
      note: input.note,
      referenceType: "transfer",
      referenceId: transferId,
    });
    ctx.setSubject("inventoryItem", source.id);
    ctx.queueEvent("catalog.stockTransferred", {
      transferId,
      fromItemId: source.id,
      toItemId: dest.id,
      quantity: input.quantity,
    });
    return {
      transferId,
      outgoing,
      incoming,
      from: await stockBalance(ctx.tx, source.id),
      to: await stockBalance(ctx.tx, dest.id),
    };
  },
});

export const availability = defineService({
  name: "catalog.availability",
  summary: "Whether a quantity of a variant can be promised at a location.",
  kind: "query",
  permission: "public",
  input: z.object({
    variantId: id,
    locationId: id.optional(),
    quantity: z.number().int().min(1).max(1_000_000).default(1),
  }),
  handler: async (input, ctx) => {
    const [variant] = await ctx.tx
      .select({
        backorderPolicy: productVariants.backorderPolicy,
        expectedRestockAt: productVariants.expectedRestockAt,
      })
      .from(productVariants)
      .where(eq(productVariants.id, input.variantId))
      .limit(1);
    const items = await ctx.tx
      .select()
      .from(inventoryItems)
      .where(
        and(
          eq(inventoryItems.variantId, input.variantId),
          ...(input.locationId ? [eq(inventoryItems.locationId, input.locationId)] : []),
        ),
      );
    const anyTracked = (
      await ctx.tx
        .select({ id: inventoryItems.id })
        .from(inventoryItems)
        .where(eq(inventoryItems.variantId, input.variantId))
        .limit(1)
    )[0];
    if (!anyTracked) {
      return { tracked: false as const, available: true as const, quantity: input.quantity };
    }
    if (items.length === 0) {
      return promiseFromPolicy({
        tracked: true,
        onHand: 0,
        reserved: 0,
        incoming: 0,
        canPromise: 0,
        quantity: input.quantity,
        policy: variant?.backorderPolicy ?? "refuse",
        restockAt: variant?.expectedRestockAt ?? null,
      });
    }
    const balances = await Promise.all(items.map((item) => stockBalance(ctx.tx, item.id)));
    const canPromise = balances.reduce((total, row) => total + Math.max(0, row.available), 0);
    const onHand = balances.reduce((total, row) => total + row.onHand, 0);
    const reserved = balances.reduce((total, row) => total + row.reserved, 0);
    const incoming = balances.reduce((total, row) => total + row.incoming, 0);
    return promiseFromPolicy({
      tracked: true,
      onHand,
      reserved,
      incoming,
      canPromise,
      quantity: input.quantity,
      policy: variant?.backorderPolicy ?? "refuse",
      restockAt: variant?.expectedRestockAt ?? null,
    });
  },
});

export const reserveStock = defineService({
  name: "catalog.reserveStock",
  summary: "Hold tracked stock for a cart, order or booking until it expires.",
  kind: "mutation",
  permission: "public",
  input: z.object({
    variantId: id,
    locationId: id,
    quantity: z.number().int().min(1).max(1_000_000),
    holderType: z.enum(STOCK_HOLDERS),
    holderId: id,
    expiresAt: z.coerce.date(),
  }),
  handler: async (input, ctx) => {
    if (input.expiresAt.getTime() <= Date.now()) {
      throw new ServiceError("validation", "A reservation must expire in the future.");
    }
    const tracked = (
      await ctx.tx
        .select({ id: inventoryItems.id })
        .from(inventoryItems)
        .where(eq(inventoryItems.variantId, input.variantId))
        .limit(1)
    )[0];
    if (!tracked) {
      return { tracked: false as const, reservation: null };
    }
    const [item] = await ctx.tx
      .select()
      .from(inventoryItems)
      .where(
        and(
          eq(inventoryItems.variantId, input.variantId),
          eq(inventoryItems.locationId, input.locationId),
        ),
      )
      .limit(1);
    if (!item) {
      throw new ServiceError("validation", "That variant is not tracked at this location.");
    }
    await lockItem(ctx.tx, item.id);
    const balance = await stockBalance(ctx.tx, item.id);
    if (balance.available < input.quantity) {
      throw new ServiceError("validation", "There is not enough available stock to reserve.");
    }
    const [reservation] = await ctx.tx
      .insert(stockReservations)
      .values({
        inventoryItemId: item.id,
        quantity: input.quantity,
        holderType: input.holderType,
        holderId: input.holderId,
        expiresAt: input.expiresAt,
      })
      .returning();
    ctx.setSubject("stockReservation", reservation!.id);
    ctx.queueEvent("catalog.stockReserved", {
      reservationId: reservation!.id,
      itemId: item.id,
      quantity: input.quantity,
    });
    return {
      tracked: true as const,
      reservation: reservation!,
      balance: await stockBalance(ctx.tx, item.id),
    };
  },
});

export const releaseReservation = defineService({
  name: "catalog.releaseReservation",
  summary: "Release a hold without taking stock off the shelf.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({ id }),
  handler: async (input, ctx) => {
    const [row] = await ctx.tx
      .select()
      .from(stockReservations)
      .where(eq(stockReservations.id, input.id))
      .for("update");
    if (!row) throw new ServiceError("not_found", "That reservation is not here.");
    if (row.status !== "active") {
      throw new ServiceError("conflict", "That reservation is no longer active.");
    }
    await lockItem(ctx.tx, row.inventoryItemId);
    const [updated] = await ctx.tx
      .update(stockReservations)
      .set({ status: "released", updatedAt: sql`now()` })
      .where(eq(stockReservations.id, row.id))
      .returning();
    ctx.setSubject("stockReservation", row.id);
    return { reservation: updated!, balance: await stockBalance(ctx.tx, row.inventoryItemId) };
  },
});

export const consumeReservation = defineService({
  name: "catalog.consumeReservation",
  summary: "Turn an active hold into a sale movement.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({ id, note: z.string().trim().min(1).max(500).optional() }),
  handler: async (input, ctx) => {
    const [row] = await ctx.tx
      .select()
      .from(stockReservations)
      .where(eq(stockReservations.id, input.id))
      .for("update");
    if (!row) throw new ServiceError("not_found", "That reservation is not here.");
    if (row.status !== "active") {
      throw new ServiceError("conflict", "That reservation is no longer active.");
    }
    if (row.expiresAt.getTime() <= Date.now()) {
      throw new ServiceError("conflict", "That reservation has expired.");
    }
    await lockItem(ctx.tx, row.inventoryItemId);
    await ctx.tx
      .update(stockReservations)
      .set({ status: "consumed", updatedAt: sql`now()` })
      .where(eq(stockReservations.id, row.id));
    await assertPhysical(ctx.tx, row.inventoryItemId, -row.quantity);
    const movement = await writeMovement(ctx.tx, {
      itemId: row.inventoryItemId,
      delta: -row.quantity,
      reason: "sale",
      actor: actorString(ctx.actor),
      note: input.note,
      referenceType: row.holderType,
      referenceId: row.holderId,
    });
    ctx.setSubject("stockReservation", row.id);
    ctx.queueEvent("catalog.stockMoved", {
      itemId: row.inventoryItemId,
      movementId: movement.id,
      delta: -row.quantity,
      reason: "sale",
    });
    return { movement, balance: await stockBalance(ctx.tx, row.inventoryItemId) };
  },
});

export const expireReservations = defineService({
  name: "catalog.expireReservations",
  summary: "Mark overdue stock holds expired so the units become available again.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({}),
  handler: async (_input, ctx) => {
    const expired = await ctx.tx
      .update(stockReservations)
      .set({ status: "expired", updatedAt: sql`now()` })
      .where(
        and(
          eq(stockReservations.status, "active"),
          sql`${stockReservations.expiresAt} <= now()`,
        ),
      )
      .returning({ id: stockReservations.id });
    return { expired: expired.length };
  },
});

export const listReservations = defineService({
  name: "catalog.listReservations",
  summary: "Active and recent stock holds for one inventory item.",
  kind: "query",
  permission: "scoped",
  input: z.object({ itemId: id }),
  handler: (input, ctx) =>
    ctx.tx
      .select()
      .from(stockReservations)
      .where(eq(stockReservations.inventoryItemId, input.itemId))
      .orderBy(desc(stockReservations.createdAt)),
});

export const listTrackedVariantChoices = defineService({
  name: "catalog.listTrackedVariantChoices",
  summary: "Active variants an owner can start tracking.",
  kind: "query",
  permission: "scoped",
  input: z.object({}),
  handler: (_input, ctx) =>
    ctx.tx
      .select({
        id: productVariants.id,
        sku: productVariants.sku,
        productName: products.name,
      })
      .from(productVariants)
      .innerJoin(products, eq(products.id, productVariants.productId))
      .where(and(eq(productVariants.status, "active"), inArray(products.status, ["active", "draft"])))
      .orderBy(asc(products.name), asc(productVariants.sku))
      .limit(200),
});

export default [
  enableInventory,
  listInventory,
  listStockMovements,
  recordStockMovement,
  countStock,
  adjustStock,
  recordDamage,
  transferStock,
  availability,
  reserveStock,
  releaseReservation,
  consumeReservation,
  expireReservations,
  listReservations,
  listTrackedVariantChoices,
];
