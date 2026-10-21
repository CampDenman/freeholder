// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The public cart page (C3.25 slice 3, gap G2 of
// deploy/c324-storefront-parity-2026-09-29.md).
//
// The cart belongs to the holder of its private token, carried in the
// fh_cart cookie exactly the way a session is — the page asks the cart
// services with that credential and renders whatever comes back. Prices are
// the live resolvePrice reading the services refresh on every cart read;
// nothing on this page stores a price as truth.
//
// SEO: a cart is a utility surface, like search — noindexed, followable,
// canonical on the bare address, at every state.

import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Button, Callout } from "@/ui/primitives";
import { purchaseOptions } from "@/modules/catalog/service";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { formatMoney } from "@/core/i18n";
import { localePath, localizeCustomerHref } from "@/core/i18n/customer";
import { siteOrigin } from "@/core/seo/origin";
import { composeDocumentTitle } from "@/core/seo/meta";
import { currentBusiness } from "@/core/settings/read";
import { getLocale, getT } from "../../i18n";
import { loadShopperCart } from "../shopper-cart";
import { recordPageView } from "../[[...slug]]/pageview";
import {
  removeCartLineAction,
  saveForLaterAction,
  updateCartLineAction,
} from "./cart-actions";

export const dynamic = "force-dynamic";

const ANONYMOUS = { kind: "anonymous" } as const;

type Query = Record<string, string | string[] | undefined>;

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<Query>;
}): Promise<Metadata> {
  await searchParams;
  const [t, business] = await Promise.all([getT(), currentBusiness()]);
  const origin = siteOrigin();
  const defaultLocale = business?.defaultLocale ?? "en";
  const canonical = `${origin}${localePath("cart", defaultLocale, defaultLocale)}`;
  return {
    title: composeDocumentTitle(t("store.cart.title"), business?.name, false),
    description: t("store.cart.summary"),
    robots: { index: false, follow: true },
    alternates: { canonical },
  };
}

export default async function CartPage({ searchParams }: { searchParams: Promise<Query> }) {
  const query = await searchParams;
  const [locale, t, business, cookieJar] = await Promise.all([
    getLocale(),
    getT(),
    currentBusiness(),
    cookies(),
  ]);
  const actor = await actorFromToken(cookieJar.get(SESSION_COOKIE)?.value);
  const signedIn = actor.kind === "user";
  const cart = await loadShopperCart();

  await recordPageView("cart", locale, query);

  const localize = (href: string) =>
    business ? localizeCustomerHref(href, locale, business) : href;
  const formatMinor = (minor: number, currency: string) =>
    formatMoney(minor, currency, locale);

  const saved = typeof query.saved === "string" ? query.saved : undefined;
  const error = typeof query.cartError === "string" ? query.cartError : undefined;

  if (!cart || cart.lines.length === 0) {
    return (
      <div className="grid gap-4">
        <h1 className="text-3xl font-bold tracking-tight text-balance text-ink">
          {t("store.cart.title")}
        </h1>
        {error ? <CartError code={error} t={t} /> : null}
        <p className="text-ink-muted">{t("store.cart.empty")}</p>
        <div>
          <a
            href={localize("/search")}
            className="inline-flex items-center rounded-md bg-accent px-4 py-2 text-sm font-semibold text-on-accent shadow-press"
          >
            {t("store.cart.emptyCta")}
          </a>
        </div>
      </div>
    );
  }

  const currency = cart.cart.currency;
  // Option labels for the lines, from the same purchase projection the shelf
  // quotes: one batched call over the lines' products.
  const purchases = await purchaseOptions.call(
    { productIds: [...new Set(cart.lines.map((line) => line.productId))] },
    ANONYMOUS,
  );
  const optionLabelByVariant = new Map(
    purchases.flatMap((product) =>
      product.variants.map((variant) => [variant.variantId, variant.optionLabel] as const),
    ),
  );

  return (
    <div className="grid gap-6">
      <header className="grid gap-2">
        <h1 className="text-3xl font-bold tracking-tight text-balance text-ink">
          {t("store.cart.title")}
        </h1>
        <p className="text-ink-muted">{t("store.cart.summary")}</p>
      </header>

      {saved === "quantity" ? <Callout tone="success">{t("store.cart.savedQuantity")}</Callout> : null}
      {saved === "removed" ? <Callout tone="success">{t("store.cart.savedRemoved")}</Callout> : null}
      {saved === "later" ? <Callout tone="success">{t("store.cart.savedLater")}</Callout> : null}
      {error ? <CartError code={error} t={t} /> : null}

      <ul className="grid list-none gap-4 p-0">
        {cart.lines.map((line) => {
          const optionLabel = optionLabelByVariant.get(line.variantId);
          const purchase = purchases.find((entry) => entry.productId === line.productId);
          return (
            <li
              key={line.id}
              className="grid gap-3 rounded-lg border border-rule bg-surface p-4 sm:grid-cols-[1fr_auto] sm:items-start"
            >
              <div className="grid gap-1">
                {purchase ? (
                  <a
                    href={localize(`/products/${purchase.slug}`)}
                    className="font-semibold text-ink hover:text-accent"
                  >
                    {line.productName}
                  </a>
                ) : (
                  <span className="font-semibold text-ink">{line.productName}</span>
                )}
                <span className="text-sm text-ink-muted">
                  {optionLabel ? optionLabel : line.sku}
                </span>
                {!line.stock.available ? (
                  <span className="text-sm text-danger">{t("store.cart.unavailable")}</span>
                ) : !line.priceAvailable ? (
                  <span className="text-sm text-ink-muted">{t("store.buy.priceUnavailable")}</span>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-3 sm:justify-end">
                <form action={updateCartLineAction} className="flex items-center gap-2">
                  <input type="hidden" name="variantId" value={line.variantId} />
                  <label className="flex items-center gap-2 text-sm text-ink-muted">
                    {t("store.cart.quantity")}
                    <input
                      type="number"
                      name="quantity"
                      min={0}
                      max={1_000_000}
                      step={1}
                      defaultValue={line.quantity}
                      className="w-20 rounded-md border border-rule bg-paper px-2 py-1.5 text-ink"
                    />
                  </label>
                  <Button type="submit" variant="quiet" className="px-3 py-1.5 text-xs">
                    {t("store.cart.update")}
                  </Button>
                </form>
                {signedIn ? (
                  <form action={saveForLaterAction}>
                    <input type="hidden" name="variantId" value={line.variantId} />
                    <Button type="submit" variant="quiet" className="px-3 py-1.5 text-xs">
                      {t("store.cart.saveForLater")}
                    </Button>
                  </form>
                ) : null}
                <form action={removeCartLineAction}>
                  <input type="hidden" name="variantId" value={line.variantId} />
                  <Button type="submit" variant="quiet" className="px-3 py-1.5 text-xs">
                    {t("store.cart.remove")}
                  </Button>
                </form>
                <span className="min-w-24 text-end text-sm font-semibold text-ink">
                  {line.lineTotalMinor === null
                    ? "—"
                    : formatMinor(line.lineTotalMinor, currency)}
                </span>
              </div>
            </li>
          );
        })}
      </ul>

      <div className="grid gap-3 rounded-lg border border-rule bg-surface p-4">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-ink-muted">{t("store.cart.subtotal")}</span>
          <span className="text-lg font-bold text-ink">
            {cart.allPriced ? formatMinor(cart.subtotalMinor, currency) : "—"}
          </span>
        </div>
        {!cart.allPriced ? (
          <p className="text-sm text-ink-muted">{t("store.cart.priceUnavailable")}</p>
        ) : null}
        <div className="flex flex-wrap items-center gap-3">
          <a
            href={localize("/checkout")}
            className="inline-flex items-center rounded-md bg-accent px-4 py-2 text-sm font-semibold text-on-accent shadow-press"
          >
            {t("store.cart.checkout")}
          </a>
          <a href={localize("/search")} className="text-sm text-accent underline-offset-2 hover:underline">
            {t("store.cart.continue")}
          </a>
        </div>
      </div>
    </div>
  );
}

function CartError({ code, t }: { code: string; t: Awaited<ReturnType<typeof getT>> }) {
  const key = `store.cart.error.${code}`;
  const known = ["expired", "validation", "permission", "conflict", "not_found", "failed"].includes(code);
  return (
    <div role="alert">
      <Callout tone="danger">{t(known ? key : "store.cart.error.failed")}</Callout>
    </div>
  );
}
