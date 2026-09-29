// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use server";
// The cart page's mutations (C3.25 slice 3): quantity, removal, and the
// saved-for-later handoff to the existing wishlist services.
//
// Every mutation carries the caller's cart capability from the cookie, so a
// crafted form without the credential changes nothing — the services refuse
// an id without the matching token (catalog.cart-access). Only result codes
// travel in the URL.
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  addWishlistItem,
  removeCartItem,
  setCartItemQuantity,
} from "@/modules/catalog/service";
import { myProfile } from "@/core/portal/service";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { ServiceError } from "@/core/service";
import { currentBusiness } from "@/core/settings/read";
import { localizeCustomerHref } from "@/core/i18n/customer";
import { getLocale } from "../../i18n";
import { readShopperCart } from "../shopper-cart";

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

async function cartPath(): Promise<string> {
  const [business, locale] = await Promise.all([currentBusiness(), getLocale()]);
  const path = "/cart";
  return business ? localizeCustomerHref(path, locale, business) : path;
}

export async function updateCartLineAction(form: FormData): Promise<void> {
  const path = await cartPath();
  const credential = await readShopperCart();
  if (!credential) redirect(`${path}?cartError=expired`);
  const quantity = Number.parseInt(text(form, "quantity"), 10);
  if (!Number.isFinite(quantity) || quantity < 0 || quantity > 1_000_000) {
    redirect(`${path}?cartError=validation`);
  }
  try {
    await setCartItemQuantity.call(
      {
        cartId: credential.cartId,
        cartToken: credential.token,
        variantId: text(form, "variantId"),
        quantity,
      },
      { kind: "anonymous" },
    );
  } catch (error) {
    redirect(`${path}?cartError=${error instanceof ServiceError ? error.code : "failed"}`);
  }
  redirect(`${path}?saved=quantity`);
}

export async function removeCartLineAction(form: FormData): Promise<void> {
  const path = await cartPath();
  const credential = await readShopperCart();
  if (!credential) redirect(`${path}?cartError=expired`);
  try {
    await removeCartItem.call(
      {
        cartId: credential.cartId,
        cartToken: credential.token,
        variantId: text(form, "variantId"),
      },
      { kind: "anonymous" },
    );
  } catch (error) {
    redirect(`${path}?cartError=${error instanceof ServiceError ? error.code : "failed"}`);
  }
  redirect(`${path}?saved=removed`);
}

/**
 * Saved for later is the contact's wishlist: it needs a signed-in customer,
 * and it both adds the variant to the wishlist and lifts the line out of the
 * cart, in the order that cannot strand a line.
 */
export async function saveForLaterAction(form: FormData): Promise<void> {
  const path = await cartPath();
  const credential = await readShopperCart();
  if (!credential) redirect(`${path}?cartError=expired`);
  const actor = await actorFromToken((await cookies()).get(SESSION_COOKIE)?.value);
  const variantId = text(form, "variantId");
  try {
    const profile = await myProfile.call({}, actor);
    await addWishlistItem.call({ contactId: profile.contactId, variantId }, actor);
    await removeCartItem.call(
      { cartId: credential.cartId, cartToken: credential.token, variantId },
      { kind: "anonymous" },
    );
  } catch (error) {
    redirect(`${path}?cartError=${error instanceof ServiceError ? error.code : "failed"}`);
  }
  redirect(`${path}?saved=later`);
}
