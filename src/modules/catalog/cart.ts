// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Persistent contact-attached carts and wishlists (C5.20).
//
// A guest cart is a token. Identifying a contact merges that token into the
// contact's open cart so a phone and a laptop become one basket. Prices and
// stock are refreshed on every read; they are never stored as truth.

import { and, asc, desc, eq, inArray, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { listed, row, timestamp, uuid } from "@/core/contract";
import { contacts } from "@/core/contacts/schema";
import { registerContactReference } from "@/core/contacts/service";
import { registerContactPrivacySource } from "@/core/privacy/service";
import { defineService, ServiceError, type ServiceContext, type Tx } from "@/core/service";
import { CART_KINDS, CART_STATUSES } from "./contract";
import { availability, releaseReservation, reserveStock } from "./inventory";
import { resolvePrice } from "./pricing";
import { cartItems, carts, productVariants, products, wishlistItems, wishlists } from "./schema";

const id = z.string().uuid();
const currency = z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/);
const CART_HOLD_MS = 30 * 60 * 1000;
const ABANDON_AFTER_MS = 24 * 60 * 60 * 1000;

const cartRow = row({
  id: uuid,
  token: z.string(),
  contactId: uuid.nullable(),
  currency: z.string(),
  kind: z.enum(CART_KINDS),
  status: z.enum(CART_STATUSES),
  name: z.string().nullable(),
  lastActivityAt: timestamp,
  abandonedAt: timestamp.nullable(),
  createdAt: timestamp,
  updatedAt: timestamp,
});
const cartStock = z.discriminatedUnion("tracked", [
  z.object({
    tracked: z.literal(false),
    available: z.boolean(),
    quantity: z.number().int().optional(),
  }),
  z.object({
    tracked: z.literal(true),
    available: z.boolean(),
    backordered: z.boolean(),
    restockAt: timestamp.nullable(),
    onHand: z.number().int(),
    reserved: z.number().int(),
    incoming: z.number().int(),
    canPromise: z.number().int(),
  }),
]);
const cartLineRow = row({
  id: uuid,
  cartId: uuid,
  variantId: uuid,
  locationId: uuid.nullable(),
  quantity: z.number().int(),
  reservationId: uuid.nullable(),
  createdAt: timestamp,
  updatedAt: timestamp,
  sku: z.string(),
  productName: z.string(),
  requiresShipping: z.boolean(),
  weightG: z.number().int().nullable(),
  lengthMm: z.number().int().nullable(),
  widthMm: z.number().int().nullable(),
  heightMm: z.number().int().nullable(),
  unitAmountMinor: z.number().int().nullable(),
  lineTotalMinor: z.number().int().nullable(),
  priceAvailable: z.boolean(),
  priceReason: z.string().nullable(),
  stock: cartStock,
});
const cartProjection = z.object({
  cart: cartRow,
  lines: listed(cartLineRow),
  subtotalMinor: z.number().int(),
  allPriced: z.boolean(),
  allAvailable: z.boolean(),
});
const wishlistRow = row({
  id: uuid,
  contactId: uuid,
  name: z.string(),
  createdAt: timestamp,
  updatedAt: timestamp,
});
const wishlistItemRow = row({
  id: uuid,
  variantId: uuid,
  sku: z.string(),
  productName: z.string(),
});

async function mergeCartLines(tx: Tx, fromCartId: string, toCartId: string) {
  const incoming = await tx.select().from(cartItems).where(eq(cartItems.cartId, fromCartId));
  for (const line of incoming) {
    const [already] = await tx
      .select()
      .from(cartItems)
      .where(and(eq(cartItems.cartId, toCartId), eq(cartItems.variantId, line.variantId)))
      .limit(1);
    if (already) {
      await tx
        .update(cartItems)
        .set({ quantity: already.quantity + line.quantity, updatedAt: sql`now()` })
        .where(eq(cartItems.id, already.id));
      await tx.delete(cartItems).where(eq(cartItems.id, line.id));
    } else {
      await tx.update(cartItems).set({ cartId: toCartId, updatedAt: sql`now()` }).where(eq(cartItems.id, line.id));
    }
  }
}

registerContactReference({
  table: "carts",
  repoint: async (tx, from, to) => {
    const incoming = await tx.select().from(carts).where(eq(carts.contactId, from));
    const openTargets = await tx
      .select()
      .from(carts)
      .where(and(eq(carts.contactId, to), eq(carts.status, "open"), eq(carts.kind, "cart")));
    const byCurrency = new Map(openTargets.map((row) => [row.currency, row]));
    for (const cart of incoming) {
      const target = cart.status === "open" && cart.kind === "cart" ? byCurrency.get(cart.currency) : undefined;
      if (target) {
        await mergeCartLines(tx, cart.id, target.id);
        await tx
          .update(carts)
          .set({ status: "converted", contactId: to, updatedAt: sql`now()` })
          .where(eq(carts.id, cart.id));
      } else {
        await tx.update(carts).set({ contactId: to, updatedAt: sql`now()` }).where(eq(carts.id, cart.id));
        if (cart.status === "open" && cart.kind === "cart") {
          byCurrency.set(cart.currency, { ...cart, contactId: to });
        }
      }
    }
  },
  captureForUndo: async (tx, duplicateId, survivingId) => {
    const rows = await tx
      .select({ id: carts.id })
      .from(carts)
      .where(inArray(carts.contactId, [duplicateId, survivingId]));
    return {
      state: rows,
      undoable: rows.length === 0,
      blocker:
        rows.length > 0
          ? "Open carts were merged and cannot be split back apart safely."
          : undefined,
    };
  },
  restoreAfterUndo: async () => undefined,
});

registerContactReference({
  table: "wishlists",
  repoint: async (tx, from, to) => {
    const [duplicate] = await tx.select().from(wishlists).where(eq(wishlists.contactId, from)).limit(1);
    const [surviving] = await tx.select().from(wishlists).where(eq(wishlists.contactId, to)).limit(1);
    if (duplicate && surviving) {
      const items = await tx.select().from(wishlistItems).where(eq(wishlistItems.wishlistId, duplicate.id));
      for (const item of items) {
        await tx
          .insert(wishlistItems)
          .values({ wishlistId: surviving.id, variantId: item.variantId })
          .onConflictDoNothing({ target: [wishlistItems.wishlistId, wishlistItems.variantId] });
      }
      await tx.delete(wishlists).where(eq(wishlists.id, duplicate.id));
      return;
    }
    if (duplicate) {
      await tx.update(wishlists).set({ contactId: to }).where(eq(wishlists.id, duplicate.id));
    }
  },
  captureForUndo: async (tx, duplicateId, survivingId) => {
    const rows = await tx
      .select({ id: wishlists.id })
      .from(wishlists)
      .where(inArray(wishlists.contactId, [duplicateId, survivingId]));
    return {
      state: rows,
      undoable: rows.length === 0,
      blocker:
        rows.length > 0
          ? "Wishlists were merged and cannot be split back apart safely."
          : undefined,
    };
  },
  restoreAfterUndo: async () => undefined,
});

registerContactPrivacySource({
  scope: "catalog.carts",
  tables: ["carts", "cart_items"],
  exportData: async (tx: Tx, contactId: string) =>
    tx
      .select({ id: carts.id, currency: carts.currency, status: carts.status, kind: carts.kind })
      .from(carts)
      .where(eq(carts.contactId, contactId)),
  erase: async (tx: Tx, contactId: string) => {
    const rows = await tx
      .update(carts)
      .set({ contactId: null, status: "abandoned", abandonedAt: sql`now()` })
      .where(eq(carts.contactId, contactId))
      .returning({ id: carts.id });
    return { affected: rows.length };
  },
});

registerContactPrivacySource({
  scope: "catalog.wishlists",
  tables: ["wishlists", "wishlist_items"],
  exportData: async (tx: Tx, contactId: string) =>
    tx
      .select({ id: wishlists.id, name: wishlists.name })
      .from(wishlists)
      .where(eq(wishlists.contactId, contactId)),
  erase: async (tx: Tx, contactId: string) => {
    const rows = await tx
      .delete(wishlists)
      .where(eq(wishlists.contactId, contactId))
      .returning({ id: wishlists.id });
    return { affected: rows.length };
  },
});

async function requireContact(tx: Tx, contactId: string) {
  const [row] = await tx.select({ id: contacts.id }).from(contacts).where(eq(contacts.id, contactId)).limit(1);
  if (!row) throw new ServiceError("not_found", "That contact is not here.");
}

async function loadCart(tx: Tx, cartId: string) {
  const [cart] = await tx.select().from(carts).where(eq(carts.id, cartId)).limit(1);
  if (!cart) throw new ServiceError("not_found", "That cart is not here.");
  return cart;
}

async function releaseLineHold(
  ctx: { callAsSystem: (service: typeof releaseReservation, input: { id: string }) => Promise<unknown> },
  reservationId: string | null,
) {
  if (!reservationId) return;
  try {
    await ctx.callAsSystem(releaseReservation, { id: reservationId });
  } catch {
    // Already expired, consumed or released — the next reserve is authoritative.
  }
}

export const getOrCreateCart = defineService({
  name: "catalog.getOrCreateCart",
  summary: "Return the open cart for a token and/or contact, creating one if needed.",
  kind: "mutation",
  permission: "public",
  input: z.object({
    token: z.string().uuid().optional(),
    contactId: id.optional(),
    currency,
  }),
  output: cartProjection,
  handler: async (input, ctx) => {
    if (input.contactId) await requireContact(ctx.tx, input.contactId);
    const [byToken] = input.token
      ? await ctx.tx.select().from(carts).where(eq(carts.token, input.token)).limit(1)
      : [];
    if (byToken && byToken.status === "open" && byToken.kind === "cart") {
      if (input.contactId && byToken.contactId !== input.contactId) {
        return ctx.call(attachCartToContact, {
          token: input.token!,
          contactId: input.contactId,
        });
      }
      return projectCart(ctx, byToken.id);
    }
    if (input.contactId) {
      const [existing] = await ctx.tx
        .select()
        .from(carts)
        .where(
          and(
            eq(carts.contactId, input.contactId),
            eq(carts.status, "open"),
            eq(carts.kind, "cart"),
            eq(carts.currency, input.currency),
          ),
        )
        .limit(1);
      if (existing) return projectCart(ctx, existing.id);
    }
    const [created] = await ctx.tx
      .insert(carts)
      .values({
        token: byToken ? crypto.randomUUID() : (input.token ?? crypto.randomUUID()),
        contactId: input.contactId ?? null,
        currency: input.currency,
      })
      .returning();
    ctx.setSubject("cart", created!.id);
    ctx.queueEvent("catalog.cartOpened", { cartId: created!.id });
    return projectCart(ctx, created!.id);
  },
});

export const attachCartToContact = defineService({
  name: "catalog.attachCartToContact",
  summary: "Merge a guest cart into the contact's open cart.",
  kind: "mutation",
  permission: "public",
  input: z.object({ token: z.string().uuid(), contactId: id }),
  output: cartProjection,
  handler: async (input, ctx) => {
    await requireContact(ctx.tx, input.contactId);
    const [guest] = await ctx.tx.select().from(carts).where(eq(carts.token, input.token)).limit(1);
    if (!guest || guest.status !== "open" || guest.kind !== "cart") {
      throw new ServiceError("not_found", "That guest cart is not here.");
    }
    const [owned] = await ctx.tx
      .select()
      .from(carts)
      .where(
        and(
          eq(carts.contactId, input.contactId),
          eq(carts.status, "open"),
          eq(carts.kind, "cart"),
          eq(carts.currency, guest.currency),
          sql`${carts.id} <> ${guest.id}`,
        ),
      )
      .limit(1);
    if (!owned) {
      await ctx.tx
        .update(carts)
        .set({ contactId: input.contactId, lastActivityAt: sql`now()`, updatedAt: sql`now()` })
        .where(eq(carts.id, guest.id));
      return projectCart(ctx, guest.id);
    }
    const incoming = await ctx.tx.select().from(cartItems).where(eq(cartItems.cartId, guest.id));
    for (const line of incoming) {
      const [already] = await ctx.tx
        .select()
        .from(cartItems)
        .where(and(eq(cartItems.cartId, owned.id), eq(cartItems.variantId, line.variantId)))
        .limit(1);
      if (already) {
        await releaseLineHold(ctx, line.reservationId);
        await ctx.tx.delete(cartItems).where(eq(cartItems.id, line.id));
        await ctx.call(addCartItem, {
          cartId: owned.id,
          variantId: line.variantId,
          quantity: line.quantity,
          locationId: line.locationId ?? already.locationId ?? undefined,
        });
      } else {
        await ctx.tx
          .update(cartItems)
          .set({ cartId: owned.id, updatedAt: sql`now()` })
          .where(eq(cartItems.id, line.id));
      }
    }
    await ctx.tx
      .update(carts)
      .set({ status: "converted", contactId: input.contactId, updatedAt: sql`now()` })
      .where(eq(carts.id, guest.id));
    return projectCart(ctx, owned.id);
  },
});

export const addCartItem = defineService({
  name: "catalog.addCartItem",
  summary: "Add or increase a variant on an open cart and hold tracked stock.",
  kind: "mutation",
  permission: "public",
  input: z.object({
    cartId: id,
    variantId: id,
    quantity: z.number().int().min(1).max(1_000_000).default(1),
    locationId: id.optional(),
  }),
  output: cartProjection,
  handler: async (input, ctx) => {
    const cart = await loadCart(ctx.tx, input.cartId);
    if (cart.status !== "open" || cart.kind !== "cart") {
      throw new ServiceError("conflict", "Only an open shopping cart can change lines.");
    }
    const [variant] = await ctx.tx
      .select({ id: productVariants.id, status: productVariants.status })
      .from(productVariants)
      .where(eq(productVariants.id, input.variantId))
      .limit(1);
    if (!variant || variant.status !== "active") {
      throw new ServiceError("not_found", "That variant is not here.");
    }
    const [existing] = await ctx.tx
      .select()
      .from(cartItems)
      .where(and(eq(cartItems.cartId, cart.id), eq(cartItems.variantId, input.variantId)))
      .limit(1);
    const nextQty = (existing?.quantity ?? 0) + input.quantity;
    const locationId = input.locationId ?? existing?.locationId ?? null;
    if (locationId) {
      const stock = await ctx.callAsSystem(availability, {
        variantId: input.variantId,
        locationId,
        quantity: nextQty,
      });
      if (!stock.available) {
        throw new ServiceError("validation", "There is not enough stock to add that quantity.");
      }
    }
    await releaseLineHold(ctx, existing?.reservationId ?? null);
    let reservationId: string | null = null;
    if (locationId) {
      const hold = await ctx.callAsSystem(reserveStock, {
        variantId: input.variantId,
        locationId,
        quantity: nextQty,
        holderType: "cart" as const,
        holderId: cart.id,
        expiresAt: new Date(Date.now() + CART_HOLD_MS),
      });
      reservationId = hold.reservation?.id ?? null;
    }
    if (existing) {
      await ctx.tx
        .update(cartItems)
        .set({ quantity: nextQty, locationId, reservationId, updatedAt: sql`now()` })
        .where(eq(cartItems.id, existing.id));
    } else {
      await ctx.tx.insert(cartItems).values({
        cartId: cart.id,
        variantId: input.variantId,
        quantity: nextQty,
        locationId,
        reservationId,
      });
    }
    await ctx.tx
      .update(carts)
      .set({ lastActivityAt: sql`now()`, updatedAt: sql`now()` })
      .where(eq(carts.id, cart.id));
    ctx.setSubject("cart", cart.id);
    ctx.queueEvent("catalog.cartItemAdded", { cartId: cart.id, variantId: input.variantId });
    return projectCart(ctx, cart.id);
  },
});

export const setCartItemQuantity = defineService({
  name: "catalog.setCartItemQuantity",
  summary: "Set a cart line quantity, or remove it at zero.",
  kind: "mutation",
  permission: "public",
  input: z.object({
    cartId: id,
    variantId: id,
    quantity: z.number().int().min(0).max(1_000_000),
    locationId: id.optional(),
  }),
  output: cartProjection,
  handler: async (input, ctx) => {
    if (input.quantity === 0) {
      return ctx.call(removeCartItem, { cartId: input.cartId, variantId: input.variantId });
    }
    const cart = await loadCart(ctx.tx, input.cartId);
    const [existing] = await ctx.tx
      .select()
      .from(cartItems)
      .where(and(eq(cartItems.cartId, cart.id), eq(cartItems.variantId, input.variantId)))
      .limit(1);
    if (!existing) throw new ServiceError("not_found", "That cart line is not here.");
    const delta = input.quantity - existing.quantity;
    if (delta > 0) {
      return ctx.call(addCartItem, {
        cartId: input.cartId,
        variantId: input.variantId,
        quantity: delta,
        locationId: input.locationId ?? existing.locationId ?? undefined,
      });
    }
    await releaseLineHold(ctx, existing.reservationId);
    let reservationId: string | null = null;
    const locationId = input.locationId ?? existing.locationId;
    if (locationId) {
      const hold = await ctx.callAsSystem(reserveStock, {
        variantId: input.variantId,
        locationId,
        quantity: input.quantity,
        holderType: "cart",
        holderId: cart.id,
        expiresAt: new Date(Date.now() + CART_HOLD_MS),
      });
      reservationId = hold.reservation?.id ?? null;
    }
    await ctx.tx
      .update(cartItems)
      .set({ quantity: input.quantity, reservationId, updatedAt: sql`now()` })
      .where(eq(cartItems.id, existing.id));
    await ctx.tx
      .update(carts)
      .set({ lastActivityAt: sql`now()`, updatedAt: sql`now()` })
      .where(eq(carts.id, cart.id));
    return projectCart(ctx, cart.id);
  },
});

export const removeCartItem = defineService({
  name: "catalog.removeCartItem",
  summary: "Remove a variant from an open cart and release its hold.",
  kind: "mutation",
  permission: "public",
  input: z.object({ cartId: id, variantId: id }),
  output: cartProjection,
  handler: async (input, ctx) => {
    const cart = await loadCart(ctx.tx, input.cartId);
    const [existing] = await ctx.tx
      .select()
      .from(cartItems)
      .where(and(eq(cartItems.cartId, cart.id), eq(cartItems.variantId, input.variantId)))
      .limit(1);
    if (!existing) throw new ServiceError("not_found", "That cart line is not here.");
    await releaseLineHold(ctx, existing.reservationId);
    await ctx.tx.delete(cartItems).where(eq(cartItems.id, existing.id));
    await ctx.tx
      .update(carts)
      .set({ lastActivityAt: sql`now()`, updatedAt: sql`now()` })
      .where(eq(carts.id, cart.id));
    return projectCart(ctx, cart.id);
  },
});

export const getCart = defineService({
  name: "catalog.getCart",
  summary: "Read a cart with live prices and stock.",
  kind: "query",
  permission: "public",
  input: z.object({ cartId: id.optional(), token: z.string().uuid().optional() }),
  output: cartProjection,
  handler: async (input, ctx) => {
    if (!input.cartId && !input.token) {
      throw new ServiceError("validation", "A cart id or token is required.");
    }
    const [cart] = input.cartId
      ? await ctx.tx.select().from(carts).where(eq(carts.id, input.cartId)).limit(1)
      : await ctx.tx.select().from(carts).where(eq(carts.token, input.token!)).limit(1);
    if (!cart) throw new ServiceError("not_found", "That cart is not here.");
    return projectCart(ctx, cart.id);
  },
});

export const saveCart = defineService({
  name: "catalog.saveCart",
  summary: "Snapshot the current lines onto a named saved cart.",
  kind: "mutation",
  permission: "public",
  input: z.object({ cartId: id, name: z.string().trim().min(1).max(80) }),
  output: cartProjection,
  handler: async (input, ctx) => {
    const source = await projectCart(ctx, input.cartId);
    if (!source.cart.contactId) {
      throw new ServiceError("validation", "A saved cart must belong to a contact.");
    }
    const [saved] = await ctx.tx
      .insert(carts)
      .values({
        token: crypto.randomUUID(),
        contactId: source.cart.contactId,
        currency: source.cart.currency,
        kind: "saved",
        status: "open",
        name: input.name,
      })
      .returning();
    for (const line of source.lines) {
      await ctx.tx.insert(cartItems).values({
        cartId: saved!.id,
        variantId: line.variantId,
        quantity: line.quantity,
        locationId: line.locationId,
      });
    }
    ctx.setSubject("cart", saved!.id);
    return projectCart(ctx, saved!.id);
  },
});

export const listSavedCarts = defineService({
  name: "catalog.listSavedCarts",
  summary: "Named saved carts for one contact.",
  kind: "query",
  permission: "public",
  input: z.object({ contactId: id }),
  output: listed(cartProjection),
  handler: async (input, ctx) => {
    const rows = await ctx.tx
      .select()
      .from(carts)
      .where(and(eq(carts.contactId, input.contactId), eq(carts.kind, "saved")))
      .orderBy(desc(carts.updatedAt));
    return Promise.all(rows.map((row) => projectCart(ctx, row.id)));
  },
});

export const addWishlistItem = defineService({
  name: "catalog.addWishlistItem",
  summary: "Put a variant on the contact's wishlist.",
  kind: "mutation",
  permission: "public",
  input: z.object({ contactId: id, variantId: id }),
  output: z.object({
    wishlist: wishlistRow.nullable(),
    items: listed(wishlistItemRow),
  }),
  handler: async (input, ctx) => {
    await requireContact(ctx.tx, input.contactId);
    let [list] = await ctx.tx.select().from(wishlists).where(eq(wishlists.contactId, input.contactId)).limit(1);
    if (!list) {
      [list] = await ctx.tx.insert(wishlists).values({ contactId: input.contactId }).returning();
    }
    await ctx.tx
      .insert(wishlistItems)
      .values({ wishlistId: list!.id, variantId: input.variantId })
      .onConflictDoNothing({ target: [wishlistItems.wishlistId, wishlistItems.variantId] });
    ctx.setSubject("wishlist", list!.id);
    return ctx.call(listWishlist, { contactId: input.contactId });
  },
});

export const removeWishlistItem = defineService({
  name: "catalog.removeWishlistItem",
  summary: "Remove a variant from the contact's wishlist.",
  kind: "mutation",
  permission: "public",
  input: z.object({ contactId: id, variantId: id }),
  output: z.object({
    wishlist: wishlistRow.nullable(),
    items: listed(wishlistItemRow),
  }),
  handler: async (input, ctx) => {
    const [list] = await ctx.tx.select().from(wishlists).where(eq(wishlists.contactId, input.contactId)).limit(1);
    if (list) {
      await ctx.tx
        .delete(wishlistItems)
        .where(and(eq(wishlistItems.wishlistId, list.id), eq(wishlistItems.variantId, input.variantId)));
    }
    return ctx.call(listWishlist, { contactId: input.contactId });
  },
});

export const listWishlist = defineService({
  name: "catalog.listWishlist",
  summary: "The contact's wishlist variants.",
  kind: "query",
  permission: "public",
  input: z.object({ contactId: id }),
  output: z.object({
    wishlist: wishlistRow.nullable(),
    items: listed(wishlistItemRow),
  }),
  handler: async (input, ctx) => {
    const [list] = await ctx.tx.select().from(wishlists).where(eq(wishlists.contactId, input.contactId)).limit(1);
    if (!list) return { wishlist: null, items: [] };
    const items = await ctx.tx
      .select({
        id: wishlistItems.id,
        variantId: wishlistItems.variantId,
        sku: productVariants.sku,
        productName: products.name,
      })
      .from(wishlistItems)
      .innerJoin(productVariants, eq(productVariants.id, wishlistItems.variantId))
      .innerJoin(products, eq(products.id, productVariants.productId))
      .where(eq(wishlistItems.wishlistId, list.id))
      .orderBy(asc(products.name));
    return { wishlist: list, items };
  },
});

export const listSellableVariants = defineService({
  name: "catalog.listSellableVariants",
  summary: "Active variants staff can add to a cart or wishlist.",
  kind: "query",
  permission: "scoped",
  input: z.object({}),
  output: listed(
    row({
      id: uuid,
      sku: z.string(),
      productName: z.string(),
      requiresShipping: z.boolean(),
    }),
  ),
  handler: (_input, ctx) =>
    ctx.tx
      .select({
        id: productVariants.id,
        sku: productVariants.sku,
        productName: products.name,
        requiresShipping: productVariants.requiresShipping,
      })
      .from(productVariants)
      .innerJoin(products, eq(products.id, productVariants.productId))
      .where(eq(productVariants.status, "active"))
      .orderBy(asc(products.name), asc(productVariants.sku))
      .limit(500),
});

export const listCarts = defineService({
  name: "catalog.listCarts",
  summary: "Open and abandoned carts for the owner workspace.",
  kind: "query",
  permission: "scoped",
  input: z.object({ status: z.enum(["open", "converted", "abandoned"]).optional() }),
  output: listed(cartRow),
  handler: (input, ctx) =>
    ctx.tx
      .select()
      .from(carts)
      .where(input.status ? eq(carts.status, input.status) : undefined)
      .orderBy(desc(carts.lastActivityAt))
      .limit(200),
});

export const abandonStaleCarts = defineService({
  name: "catalog.abandonStaleCarts",
  summary: "Mark inactive open carts abandoned and release their stock holds.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({}),
  output: z.object({ abandoned: z.number().int() }),
  handler: async (_input, ctx) => {
    const cutoff = new Date(Date.now() - ABANDON_AFTER_MS);
    const stale = await ctx.tx
      .select()
      .from(carts)
      .where(
        and(
          eq(carts.status, "open"),
          eq(carts.kind, "cart"),
          lt(carts.lastActivityAt, cutoff),
        ),
      );
    for (const cart of stale) {
      const lines = await ctx.tx.select().from(cartItems).where(eq(cartItems.cartId, cart.id));
      for (const line of lines) {
        await releaseLineHold(ctx, line.reservationId);
        if (line.reservationId) {
          await ctx.tx.update(cartItems).set({ reservationId: null }).where(eq(cartItems.id, line.id));
        }
      }
      await ctx.tx
        .update(carts)
        .set({ status: "abandoned", abandonedAt: sql`now()`, updatedAt: sql`now()` })
        .where(eq(carts.id, cart.id));
      ctx.queueEvent("catalog.cartAbandoned", { cartId: cart.id });
    }
    return { abandoned: stale.length };
  },
});

async function projectCart(ctx: ServiceContext, cartId: string) {
  const cart = await loadCart(ctx.tx, cartId);
  const rows = await ctx.tx
    .select({
      item: cartItems,
      sku: productVariants.sku,
      productName: products.name,
      requiresShipping: productVariants.requiresShipping,
      weightG: productVariants.weightG,
      lengthMm: productVariants.lengthMm,
      widthMm: productVariants.widthMm,
      heightMm: productVariants.heightMm,
    })
    .from(cartItems)
    .innerJoin(productVariants, eq(productVariants.id, cartItems.variantId))
    .innerJoin(products, eq(products.id, productVariants.productId))
    .where(eq(cartItems.cartId, cart.id));
  const lines = [];
  for (const row of rows) {
    const priced = await ctx.callAsSystem(resolvePrice, {
      variantId: row.item.variantId,
      currency: cart.currency,
      contactId: cart.contactId ?? undefined,
      quantity: row.item.quantity,
    });
    const stock = row.item.locationId
      ? await ctx.callAsSystem(availability, {
          variantId: row.item.variantId,
          locationId: row.item.locationId,
          quantity: row.item.quantity,
        })
      : { tracked: false, available: true };
    lines.push({
      ...row.item,
      sku: row.sku,
      productName: row.productName,
      requiresShipping: row.requiresShipping,
      weightG: row.weightG,
      lengthMm: row.lengthMm,
      widthMm: row.widthMm,
      heightMm: row.heightMm,
      unitAmountMinor: priced.available ? priced.amountMinor ?? null : null,
      lineTotalMinor: priced.available ? priced.totalMinor ?? null : null,
      priceAvailable: priced.available,
      priceReason: priced.reason ?? null,
      stock,
    });
  }
  const subtotalMinor = lines.reduce((sum, line) => sum + (line.lineTotalMinor ?? 0), 0);
  return {
    cart,
    lines,
    subtotalMinor,
    allPriced: lines.every((line) => line.priceAvailable && line.lineTotalMinor != null),
    allAvailable: lines.every((line) => line.stock.available !== false),
  };
}

export default [
  getOrCreateCart,
  attachCartToContact,
  addCartItem,
  setCartItemQuantity,
  removeCartItem,
  getCart,
  saveCart,
  listSavedCarts,
  addWishlistItem,
  removeWishlistItem,
  listWishlist,
  listSellableVariants,
  listCarts,
  abandonStaleCarts,
];
