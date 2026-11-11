// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C5.16/C5.20/C8.08: one holder reservation per stock item, many photo lines.
import { and, asc, eq, inArray, or } from "drizzle-orm";
import type { ServiceContext } from "@/core/service";
import { releaseReservation, reserveStock, stockBalance } from "./inventory";
import { cartItems, inventoryItems, stockReservations } from "./schema";

type StockLine = { variantId: string; locationId: string | null; quantity: number };
export function aggregateStockLines(lines: readonly StockLine[]): StockLine[] {
  const groups = new Map<string, StockLine>();
  for (const line of lines) {
    if (!line.locationId) continue;
    const key = `${line.variantId}:${line.locationId}`;
    const existing = groups.get(key);
    if (existing) existing.quantity += line.quantity;
    else groups.set(key, { variantId: line.variantId, locationId: line.locationId, quantity: line.quantity });
  }
  return [...groups.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, group]) => group);
}

async function stockSnapshot(ctx: ServiceContext, cartIds: string[], variantIds?: string[]) {
  const lines = await ctx.tx.select().from(cartItems).where(and(inArray(cartItems.cartId, cartIds), variantIds ? inArray(cartItems.variantId, variantIds) : undefined));
  // Match release/consume's reservation -> inventory lock order. Lock all
  // affected inventory rows in stable order before rebuilding any group.
  const held = await ctx.tx.select({ id: stockReservations.id, itemId: stockReservations.inventoryItemId })
    .from(stockReservations).innerJoin(inventoryItems, eq(inventoryItems.id, stockReservations.inventoryItemId))
    .where(and(eq(stockReservations.holderType, "cart"), inArray(stockReservations.holderId, cartIds), eq(stockReservations.status, "active"), variantIds ? inArray(inventoryItems.variantId, variantIds) : undefined))
    .orderBy(asc(stockReservations.inventoryItemId), asc(stockReservations.id)).for("update", { of: stockReservations });
  const variants = [...new Set(lines.map(line => line.variantId))];
  const items = held.length || variants.length ? await ctx.tx.select({ id: inventoryItems.id, variantId: inventoryItems.variantId, locationId: inventoryItems.locationId }).from(inventoryItems)
    .where(or(held.length ? inArray(inventoryItems.id, held.map(hold => hold.itemId)) : undefined, variants.length ? inArray(inventoryItems.variantId, variants) : undefined))
    .orderBy(asc(inventoryItems.id)).for("update") : [];
  return { lines, held, items };
}

/** Caller holds every affected cart lock. Prelock multi-cart merge batches. */
export async function lockCartStock(ctx: ServiceContext, cartIds: string[]): Promise<void> {
  if (cartIds.length) await stockSnapshot(ctx, cartIds);
}

/** Never release a reservation by an unchecked line pointer. */
async function updateCartStock(ctx: ServiceContext, cartId: string, variantIds: string[] | undefined, rebuild: boolean, allowPartial = false, releaseFrom: string[] = []): Promise<void> {
  const cartIds = [...new Set([cartId, ...releaseFrom])];
  const { lines, held, items } = await stockSnapshot(ctx, cartIds, variantIds);
  for (const hold of held) await ctx.callAsSystem(releaseReservation, { id: hold.id });
  await ctx.tx.update(cartItems).set({ reservationId: null }).where(and(inArray(cartItems.cartId, cartIds), variantIds ? inArray(cartItems.variantId, variantIds) : undefined));
  if (!rebuild) return;
  for (const group of aggregateStockLines(lines.filter(line => line.cartId === cartId))) {
    const item = items.find(item => item.variantId === group.variantId && item.locationId === group.locationId);
    // Reducing/restoring a cart must remain possible after its hold expires.
    // Hold only available physical units and let the normal projection report
    // any unmet demand; checkout still requires the complete quantity.
    const quantity = allowPartial ? item ? Math.min(group.quantity, Math.max(0, (await stockBalance(ctx.tx, item.id)).available)) : 0 : group.quantity;
    if (!quantity) continue;
    const held = await ctx.callAsSystem(reserveStock, { variantId: group.variantId, locationId: group.locationId!, quantity, holderType: "cart", holderId: cartId, expiresAt: new Date(Date.now() + 30 * 60 * 1000) });
    if (held.reservation) await ctx.tx.update(cartItems).set({ reservationId: held.reservation.id }).where(and(eq(cartItems.cartId, cartId), eq(cartItems.variantId, group.variantId), eq(cartItems.locationId, group.locationId!)));
  }
}

export async function reconcileCartStock(ctx: ServiceContext, cartId: string, variantIds: string[], options: { allowPartial?: boolean } = {}): Promise<void> {
  await updateCartStock(ctx, cartId, variantIds, true, options.allowPartial);
}
export async function releaseCartStock(ctx: ServiceContext, cartId: string): Promise<void> {
  await updateCartStock(ctx, cartId, undefined, false);
}
export async function mergeCartStock(ctx: ServiceContext, fromCartId: string, toCartId: string): Promise<void> {
  await updateCartStock(ctx, toCartId, undefined, true, true, [fromCartId]);
}
