// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use server";
// The buy button's door into the cart services (C3.25 slice 3).
//
// A Server Action for the same reason submitPublicForm is one: the form works
// before any JavaScript has loaded, and Next verifies the request Origin for
// actions, so the mutation carries its own CSRF defence. Only result codes
// travel in the URL — never free text (the form block sets that doctrine).
import { headers } from "next/headers";
import { redirect } from "next/navigation";
// Direct module imports, not the catalog barrel: the cms block registry
// loads this action through the cartWidget/productDetail blocks, and the
// barrel pulls the cms schema helpers back in — the cycle would boot the
// registry before blockTreeSchema exists.
import { addCartItem, getOrCreateCart } from "@/modules/catalog/cart";
import { ServiceError } from "@/core/service";
import { PATH_HEADER } from "@/core/http/headers";
import { currentBusiness } from "@/core/settings/read";
import { getLocale } from "../../i18n";
import { localizeCustomerHref } from "@/core/i18n/customer";
import {
  readShopperCart,
  storeShopperCart,
} from "../shopper-cart";

const ANONYMOUS = { kind: "anonymous" } as const;

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Where to come back to: this request's own path, localized — never a value
 * from the form, which would be an open redirect waiting for a crafted link.
 */
async function returnPath(): Promise<string> {
  const [requestHeaders, business, locale] = await Promise.all([
    headers(),
    currentBusiness(),
    getLocale(),
  ]);
  const barePath = requestHeaders.get(PATH_HEADER) ?? "/";
  return business ? localizeCustomerHref(barePath, locale, business) : barePath;
}

export async function addToCartAction(form: FormData): Promise<void> {
  const variantId = text(form, "variantId");
  const product = text(form, "product").slice(0, 180);
  const path = await returnPath();
  const marker = product ? encodeURIComponent(product) : "1";

  try {
    const credential = await readShopperCart();
    let cart;
    if (credential) {
      try {
        cart = await addCartItem.call(
          {
            cartId: credential.cartId,
            cartToken: credential.token,
            variantId,
            quantity: 1,
          },
          ANONYMOUS,
        );
      } catch (error) {
        // A stale capability (converted, abandoned or tampered with) starts
        // a fresh cart rather than failing the shopper's click.
        if (!(error instanceof ServiceError)) throw error;
        cart = null;
      }
    }
    if (!cart) {
      const business = await currentBusiness();
      const opened = await getOrCreateCart.call(
        {
          token: credential?.token,
          currency: business?.baseCurrency ?? "USD",
        },
        ANONYMOUS,
      );
      cart = await addCartItem.call(
        { cartId: opened.cart.id, cartToken: opened.cart.token!, variantId, quantity: 1 },
        ANONYMOUS,
      );
    }
    if (cart.cart.token) {
      await storeShopperCart({ cartId: cart.cart.id, token: cart.cart.token });
    }
  } catch {
    redirect(`${path}?cartError=add`);
  }
  redirect(`${path}?added=${marker}`);
}
