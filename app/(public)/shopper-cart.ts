// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The storefront's guest-cart capability, carried the same way a session is
// (C3.25 slice 3, gap G2 of deploy/c324-storefront-parity-2026-09-29.md).
//
// The cookie value is `<cart id>.<cart token>`; the token half is the private
// capability catalog.cart-access requires, so this is HttpOnly and SameSite
// and never touched by client script. The routing layer reads and writes it —
// src/ stays framework-agnostic (§10) — and hands the pair to the cart
// services, which continue to refuse an id without the matching token.

import { cookies } from "next/headers";
// Direct module import, not the catalog barrel: this helper is loaded through
// the chrome block path, and the barrel pulls the cms schema helpers back in
// before the block registry has finished booting.
import { getCart } from "@/modules/catalog/cart";
import { SHOPPER_CART_COOKIE } from "@/modules/catalog/cookies";

const COOKIE_MAX_AGE_SECONDS = 180 * 24 * 60 * 60;

export interface ShopperCartCredential {
  cartId: string;
  token: string;
}

function parse(raw: string | undefined): ShopperCartCredential | null {
  if (!raw) return null;
  const [cartId, token, extra] = raw.split(".");
  if (extra !== undefined) return null;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cartId ?? "")) {
    return null;
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token ?? "")) {
    return null;
  }
  return { cartId: cartId!, token: token! };
}

/** The caller's cart capability, or null when the browser carries none. */
export async function readShopperCart(): Promise<ShopperCartCredential | null> {
  return parse((await cookies()).get(SHOPPER_CART_COOKIE)?.value);
}

/**
 * The live cart projection behind the cookie credential, or null when there
 * is no cookie or the cart no longer answers to it (expired, converted,
 * tampered). Callers treat null as "no cart" rather than as an error.
 */
export async function loadShopperCart() {
  const credential = await readShopperCart();
  if (!credential) return null;
  try {
    return await getCart.call(
      { cartId: credential.cartId, token: credential.token },
      { kind: "anonymous" },
    );
  } catch {
    return null;
  }
}

/** Server-action side: store a freshly issued (or merged) cart capability. */
export async function storeShopperCart(credential: ShopperCartCredential): Promise<void> {
  (await cookies()).set(SHOPPER_CART_COOKIE, `${credential.cartId}.${credential.token}`, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: COOKIE_MAX_AGE_SECONDS,
  });
}

/** Server-action side: drop the capability (checkout converted the cart). */
export async function clearShopperCart(): Promise<void> {
  (await cookies()).delete(SHOPPER_CART_COOKIE);
}

/**
 * The chrome widget's view of the cart (counts and totals only). Reading the
 * cookie and asking the cart service for the projection both happen here in
 * the routing layer; the cms block receives this shape through the render
 * context and never sees the credential itself.
 */
export async function loadShopperCartSnapshot() {
  const projection = await loadShopperCart();
  if (!projection) return null;
  return {
    currency: projection.cart.currency,
    lineCount: projection.lines.reduce((total, line) => total + line.quantity, 0),
    subtotalMinor: projection.subtotalMinor,
    lines: projection.lines.map((line) => ({
      variantId: line.variantId,
      productName: line.productName,
      quantity: line.quantity,
      lineTotalMinor: line.lineTotalMinor,
    })),
  };
}
