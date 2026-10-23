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
import { cookies, headers } from "next/headers";
import { requestMetadataFromHeaders } from "@/core/http/request-metadata";
import { redirect } from "next/navigation";
import { getCart, quoteShipping, shopperCheckout } from "@/modules/catalog/service";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { ServiceError } from "@/core/service";
import {
  encodeFormReturn,
  FORM_RETURN_COOKIE,
  FORM_RETURN_MAX_AGE,
} from "@/core/http/public-form-return";
import { CHECKOUT_RETURN_KEY, checkoutRefusal, type CheckoutField } from "@/modules/catalog/checkout-fields";
import { PLAYGROUND_FICTIONAL_EMAIL, PLAYGROUND_REFUSAL } from "@/core/demo/playground-policy";
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
  // C1.38: a playground refusal is not "this cart belongs to someone else".
  if (error instanceof ServiceError && error.code === "permission" && error.message === PLAYGROUND_REFUSAL) {
    return "playground";
  }
  if (error instanceof ServiceError && error.message === PLAYGROUND_FICTIONAL_EMAIL) {
    return "playgroundEmail";
  }
  return error instanceof ServiceError ? error.code : "failed";
}

/** What the shopper typed that is worth giving back: never tokens or keys. */
const KEPT_FIELDS = ["email", "name", "street1", "city", "region", "postalCode", "country", "shippingMethodId", "couponCode"];

/**
 * Hand the shopper's answers back to their own browser for the next render
 * (the public-form-return pattern) and send them to the refusal, with the
 * fields it is about named in the URL — codes only, never text.
 */
async function refuse(path: string, form: FormData, reason: string, fields: readonly CheckoutField[] = []): Promise<never> {
  const values: Record<string, string> = {};
  for (const name of KEPT_FIELDS) values[name] = text(form, name);
  const kept = encodeFormReturn(CHECKOUT_RETURN_KEY, values);
  const jar = await cookies();
  if (kept) {
    jar.set(FORM_RETURN_COOKIE, kept, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: FORM_RETURN_MAX_AGE,
    });
  }
  const named = fields.length ? `&fields=${fields.join(",")}` : "";
  redirect(`${path}?error=${reason}${named}`);
}

export async function shopperCheckoutAction(form: FormData): Promise<void> {
  const path = await localize("/checkout");
  const credential = await readShopperCart();
  if (!credential) redirect(`${path}?error=expired`);
  if (form.get("acceptedTerms") !== "on") await refuse(path, form, "terms");

  const country = text(form, "country").toUpperCase();
  const addressFields = {
    street1: text(form, "street1"),
    city: text(form, "city"),
    region: text(form, "region").toUpperCase(),
    postalCode: text(form, "postalCode").toUpperCase(),
  };
  const anyAddressField = country || Object.values(addressFields).some(Boolean);
  if (anyAddressField && !/^[A-Z]{2}$/.test(country)) await refuse(path, form, "address", ["country"]);

  let outcome: Awaited<ReturnType<typeof shopperCheckout.call>>;
  try {
    // With the client address, so per-client limits (the playground's
    // among them) key on this shopper rather than on everyone at once.
    const actor = {
      ...(await actorFromToken((await cookies()).get(SESSION_COOKIE)?.value)),
      request: requestMetadataFromHeaders(await headers()),
    };
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
        termsVersion: text(form, "termsVersion") || undefined,
        termsHash: text(form, "termsHash") || undefined,
        idempotencyKey: text(form, "idempotencyKey") || randomUUID(),
        locale: await getLocale(),
      },
      actor,
    );
  } catch (error) {
    // The visitor sees a code and the fields it is about, with their answers
    // given back; the operator sees the cause in the server log.
    console.error("storefront checkout failed", error);
    const refusal = checkoutRefusal(error);
    await refuse(path, form, refusal?.reason ?? serviceCode(error), refusal?.fields ?? []);
  }

  // redirect() throws to do its work, so the redirecting branches live
  // outside the try — swallowing NEXT_REDIRECT would turn every success
  // into ?error=failed.
  if (outcome!.status === "verification_sent") {
    // Nothing was refused, so no answers are kept for the next render.
    (await cookies()).delete(FORM_RETURN_COOKIE);
    redirect(`${path}?sent=1`);
  }
  // Placed. The cart is converted; drop the device credential and any
  // answers kept from an earlier refusal, and hand the browser the order's
  // own token-gated address.
  await clearShopperCart();
  (await cookies()).delete(FORM_RETURN_COOKIE);
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
