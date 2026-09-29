// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use server";
// The public checkout's two doors (C3.25 slice 3).
//
// shopperCheckoutAction is the form's POST target: it carries the cart
// capability from the cookie, and either asks for the email proof the
// C5.21 doctrine requires (verification_sent) or places the order through
// catalog.shopperCheckout and hands the browser to the token-gated
// confirmation page. quoteDeliveryAction is the progressive enhancement:
// the same catalog.quoteShipping the server validates with, offered to the
// address fields so the method list is live. Only codes travel in URLs.
import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getCart, quoteShipping, shopperCheckout } from "@/modules/catalog/service";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { ServiceError } from "@/core/service";
import { currentBusiness } from "@/core/settings/read";
import { localizeCustomerHref } from "@/core/i18n/customer";
import { getLocale } from "../../i18n";
import { clearShopperCart, readShopperCart } from "../shopper-cart";

const ANONYMOUS = { kind: "anonymous" } as const;

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

async function localize(path: string): Promise<string> {
  const [business, locale] = await Promise.all([currentBusiness(), getLocale()]);
  return business ? localizeCustomerHref(path, locale, business) : path;
}

function serviceCode(error: unknown): string {
  return error instanceof ServiceError ? error.code : "failed";
}

export async function shopperCheckoutAction(form: FormData): Promise<void> {
  const path = await localize("/checkout");
  const credential = await readShopperCart();
  if (!credential) redirect(`${path}?error=expired`);
  if (form.get("acceptedTerms") !== "on") redirect(`${path}?error=terms`);

  const country = text(form, "country").toUpperCase();
  const addressFields = {
    street1: text(form, "street1"),
    city: text(form, "city"),
    region: text(form, "region").toUpperCase(),
    postalCode: text(form, "postalCode").toUpperCase(),
  };
  const anyAddressField = country || Object.values(addressFields).some(Boolean);
  if (anyAddressField && !country) redirect(`${path}?error=address`);

  let outcome: Awaited<ReturnType<typeof shopperCheckout.call>>;
  try {
    const actor = await actorFromToken(
      (await cookies()).get(SESSION_COOKIE)?.value,
    );
    outcome = await shopperCheckout.call(
      {
        cartId: credential.cartId,
        cartToken: credential.token,
        email: text(form, "email"),
        name: text(form, "name") || undefined,
        // An address is sent only when the shopper started one; the service
        // decides whether the cart needs it, not the form.
        ...(country
          ? {
              shippingAddress: {
                ...(text(form, "name") ? { name: text(form, "name") } : {}),
                ...(addressFields.street1 ? { street1: addressFields.street1 } : {}),
                ...(addressFields.city ? { city: addressFields.city } : {}),
                ...(addressFields.region ? { region: addressFields.region } : {}),
                ...(addressFields.postalCode ? { postalCode: addressFields.postalCode } : {}),
                country,
              },
            }
          : {}),
        shippingMethodId: text(form, "shippingMethodId") || undefined,
        couponCode: text(form, "couponCode").toUpperCase() || undefined,
        acceptedTerms: true,
        idempotencyKey: text(form, "idempotencyKey") || randomUUID(),
        locale: await getLocale(),
      },
      actor,
    );
  } catch (error) {
    // The visitor sees a code; the operator sees the cause in the server log.
    console.error("storefront checkout failed", error);
    redirect(`${path}?error=${serviceCode(error)}`);
  }

  // redirect() throws to do its work, so the redirecting branches live
  // outside the try — swallowing NEXT_REDIRECT would turn every success
  // into ?error=failed.
  if (outcome!.status === "verification_sent") {
    redirect(`${path}?sent=1`);
  }
  // Placed. The cart is converted; drop the device credential and hand the
  // browser the order's own token-gated address.
  await clearShopperCart();
  redirect(
    await localize(
      `/orders/confirm?cart=${encodeURIComponent(credential.cartId)}&t=${encodeURIComponent(credential.token)}`,
    ),
  );
}

export interface DeliveryQuotes {
  needed: boolean;
  quotes: Array<{
    methodId: string;
    name: string;
    amountMinor: number;
    currency: string;
    minDays: number | null;
    maxDays: number | null;
  }>;
}

/**
 * The eligible delivery methods for the current cart at a destination — the
 * same catalog.quoteShipping checkoutCart re-runs authoritatively. Wrong or
 * missing credentials answer empty rather than probing anything.
 */
export async function quoteDeliveryAction(input: {
  country: string;
  region?: string;
  postal?: string;
}): Promise<DeliveryQuotes> {
  const empty: DeliveryQuotes = { needed: false, quotes: [] };
  const credential = await readShopperCart();
  if (!credential) return empty;
  let basket;
  try {
    basket = await getCart.call(
      { cartId: credential.cartId, token: credential.token },
      ANONYMOUS,
    );
  } catch {
    return empty;
  }
  if (!basket || basket.lines.length === 0) return empty;
  if (!basket.lines.some((line) => line.requiresShipping)) return empty;
  try {
    const quoted = await quoteShipping.call(
      {
        country: input.country.trim().toUpperCase().slice(0, 2),
        ...(input.region?.trim() ? { region: input.region.trim().toUpperCase().slice(0, 40) } : {}),
        ...(input.postal?.trim() ? { postal: input.postal.trim().toUpperCase().slice(0, 16) } : {}),
        currency: basket.cart.currency,
        items: basket.lines.map((line) => ({
          quantity: line.quantity,
          weightG: line.weightG ?? 0,
          priceMinor: line.unitAmountMinor ?? 0,
          lengthMm: line.lengthMm ?? undefined,
          widthMm: line.widthMm ?? undefined,
          heightMm: line.heightMm ?? undefined,
          requiresShipping: line.requiresShipping,
        })),
      },
      ANONYMOUS,
    );
    return {
      needed: quoted.needed,
      quotes: quoted.quotes.map((quote) => ({
        methodId: quote.methodId,
        name: quote.name,
        amountMinor: quote.amountMinor,
        currency: quote.currency,
        minDays: quote.minDays,
        maxDays: quote.maxDays,
      })),
    };
  } catch {
    return empty;
  }
}
