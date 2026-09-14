// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C5.20/C11.10: cart tokens and verified contact ownership, never bare IDs.
import { timingSafeEqual } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { contacts } from "@/core/contacts/schema";
import { hasModuleAccess, permits, ServiceError, type Actor, type ServiceContext } from "@/core/service";
import { carts } from "./schema";

export function managesCartTokens(actor: Actor): boolean {
  return hasModuleAccess(actor, "catalog", "manage") || (actor.kind === "agent" && actor.scopes.includes("catalog.*"));
}

async function ownsContact(ctx: ServiceContext, contactId: string): Promise<boolean> {
  if (ctx.actor.kind !== "user") return false;
  return Boolean((await ctx.tx.select({ id: contacts.id }).from(contacts)
    .where(and(eq(contacts.id, contactId), eq(contacts.userId, ctx.actor.userId))).limit(1))[0]);
}

export async function requireOwnedContact(ctx: ServiceContext, contactId: string, serviceName: string, kind: "query" | "mutation"): Promise<boolean> {
  const own = await ownsContact(ctx, contactId);
  if (own || permits(ctx.actor, "scoped", serviceName, kind)) return own;
  throw new ServiceError("permission", "Sign in to use your own saved cart or wishlist.");
}

export async function requireCartAccess(ctx: ServiceContext, input: { cartId: string; cartToken?: string }, serviceName: string, kind: "query" | "mutation") {
  const query = ctx.tx.select().from(carts).where(eq(carts.id, input.cartId)).limit(1);
  const [cart] = await (kind === "mutation" ? query.for("update") : query);
  if (!cart) throw new ServiceError("not_found", "That cart is not here.");
  const token = input.cartToken;
  const supplied = Boolean(token && Buffer.byteLength(token) === Buffer.byteLength(cart.token) && timingSafeEqual(Buffer.from(token), Buffer.from(cart.token)));
  const own = cart.contactId ? await ownsContact(ctx, cart.contactId) : false;
  if (!supplied && !own && !permits(ctx.actor, "scoped", serviceName, kind)) {
    throw new ServiceError("permission", "Use this cart's private token or sign in to its contact profile.");
  }
  return { cart, revealToken: supplied || own || managesCartTokens(ctx.actor) };
}
