// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The public checkout page (C3.25 slice 3, gap G2 of
// deploy/c324-storefront-parity-2026-09-29.md).
//
// Shopper-facing flow over catalog.checkoutCart through the public
// catalog.shopperCheckout entry point: contact fields resolved per the spine
// doctrine (contacts.resolve, never contacts.create), address and delivery
// method quoted from the existing shipping engine, terms, and the existing
// idempotency. Payment settles after placement on the existing customer
// invoice surface — the configured provider adapter's hosted checkout when
// one is live, offline instructions when the business collects manually —
// so this page never touches a card.
//
// Authority: naming a contact is authority over that contact (C5.21), so a
// guest's first submit triggers the platform's email proof — the customer
// magic link — and the order waits for it. A signed-in customer whose
// contact email matches has already proved it and places in one step.
//
// SEO: checkout is a private utility — noindexed, nofollowed, like the
// portal's sign-in screens.

import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { randomUUID } from "node:crypto";
import { paymentAdapter } from "@/adapters/payments";
import { Button, Callout } from "@/ui/primitives";
import { myProfile } from "@/core/portal/service";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { formatMoney } from "@/core/i18n";
import { localePath, localizeCustomerHref } from "@/core/i18n/customer";
import { siteOrigin } from "@/core/seo/origin";
import { composeDocumentTitle } from "@/core/seo/meta";
import { currentBusiness } from "@/core/settings/read";
import { getModuleConfig } from "@/core/settings/service";
import { catalogSettingsSchema, checkoutTermsHash } from "@/modules/catalog/checkout-policy";
import { getLocale, getT } from "../../i18n";
import { loadShopperCart } from "../shopper-cart";
import { recordPageView } from "../[[...slug]]/pageview";
import { shopperCheckoutAction } from "./checkout-actions";
import { DeliveryMethods } from "./DeliveryMethods";

export const dynamic = "force-dynamic";

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
  const canonical = `${origin}${localePath("checkout", defaultLocale, defaultLocale)}`;
  return {
    title: composeDocumentTitle(t("store.checkout.title"), business?.name, false),
    robots: { index: false, follow: false },
    alternates: { canonical },
  };
}

export default async function CheckoutPage({ searchParams }: { searchParams: Promise<Query> }) {
  const query = await searchParams;
  const [locale, t, business, cookieJar] = await Promise.all([
    getLocale(),
    getT(),
    currentBusiness(),
    cookies(),
  ]);
  const actor = await actorFromToken(cookieJar.get(SESSION_COOKIE)?.value);
  const cart = await loadShopperCart();
  const checkoutSettings = catalogSettingsSchema.parse(await getModuleConfig.call({ module: "catalog" }, { kind: "anonymous" }));

  await recordPageView("checkout", locale, query);

  if (!cart || cart.lines.length === 0) {
    redirect(
      business
        ? localizeCustomerHref("/cart", locale, business)
        : "/cart",
    );
  }

  const localize = (href: string) =>
    business ? localizeCustomerHref(href, locale, business) : href;
  const formatMinor = (minor: number, currency: string) =>
    formatMoney(minor, currency, locale);
  const needsShipping = cart.lines.some((line) => line.requiresShipping);

  let email = "";
  let name = "";
  if (actor.kind === "user") {
    const profile = await myProfile.call({}, actor).catch(() => null);
    if (profile) {
      email = profile.email ?? "";
      name = profile.name;
    }
  }

  const sent = query.sent === "1";
  const error = typeof query.error === "string" ? query.error : undefined;

  const adapter = paymentAdapter();
  const paymentMode = !adapter.status.available || adapter.id === "none"
    ? ("unavailable" as const)
    : adapter.id === "manual"
      ? ("manual" as const)
      : ("hosted" as const);

  const inputClass =
    "rounded-md border border-rule bg-paper px-3 py-2 text-ink w-full";

  return (
    <div className="grid gap-6">
      <header className="grid gap-2">
        <h1 className="text-3xl font-bold tracking-tight text-balance text-ink">
          {t("store.checkout.title")}
        </h1>
      </header>

      {sent ? <Callout tone="neutral">{t("store.checkout.sent")}</Callout> : null}
      {error ? <CheckoutError code={error} t={t} /> : null}
      {actor.kind === "user" && email ? (
        <Callout tone="neutral">{t("store.checkout.signedIn", { email })}</Callout>
      ) : null}

      <div className="grid items-start gap-6 lg:grid-cols-[1fr_18rem]">
        <form action={shopperCheckoutAction} className="grid gap-5">
          <input type="hidden" name="idempotencyKey" value={randomUUID()} />

          <fieldset className="grid gap-3">
            <legend className="text-sm font-semibold text-ink">
              {t("store.checkout.contactLegend")}
            </legend>
            <label className="grid gap-1 text-sm text-ink-muted">
              {t("store.checkout.email")}
              <input
                id="checkout-email"
                name="email"
                type="email"
                required
                autoComplete="email"
                defaultValue={email}
                className={inputClass}
              />
            </label>
            <label className="grid gap-1 text-sm text-ink-muted">
              {t("store.checkout.name")}
              <input
                id="checkout-name"
                name="name"
                type="text"
                autoComplete="name"
                defaultValue={name}
                className={inputClass}
              />
            </label>
          </fieldset>

          {needsShipping ? (
            <fieldset className="grid gap-3">
              <legend className="text-sm font-semibold text-ink">
                {t("store.checkout.addressLegend")}
              </legend>
              <label className="grid gap-1 text-sm text-ink-muted">
                {t("store.checkout.street1")}
                <input
                  id="checkout-street1"
                  name="street1"
                  type="text"
                  autoComplete="address-line1"
                  className={inputClass}
                />
              </label>
              <div className="grid gap-3 sm:grid-cols-3">
                <label className="grid gap-1 text-sm text-ink-muted">
                  {t("store.checkout.city")}
                  <input
                    id="checkout-city"
                    name="city"
                    type="text"
                    autoComplete="address-level2"
                    className={inputClass}
                  />
                </label>
                <label className="grid gap-1 text-sm text-ink-muted">
                  {t("store.checkout.region")}
                  <input
                    id="checkout-region"
                    name="region"
                    type="text"
                    autoComplete="address-level1"
                    className={inputClass}
                  />
                </label>
                <label className="grid gap-1 text-sm text-ink-muted">
                  {t("store.checkout.postalCode")}
                  <input
                    id="checkout-postal"
                    name="postalCode"
                    type="text"
                    autoComplete="postal-code"
                    className={inputClass}
                  />
                </label>
              </div>
              <label className="grid gap-1 text-sm text-ink-muted sm:max-w-40">
                {t("store.checkout.country")}
                <input
                  id="checkout-country"
                  name="country"
                  type="text"
                  inputMode="text"
                  autoComplete="country"
                  minLength={2}
                  maxLength={2}
                  pattern="[A-Za-z]{2}"
                  required
                  className={inputClass}
                />
              </label>
            </fieldset>
          ) : (
            <Callout tone="neutral">{t("store.checkout.noShipping")}</Callout>
          )}

          {needsShipping ? (
            <DeliveryMethods
              labels={{
                legend: t("store.checkout.deliveryLegend"),
                note: t("store.checkout.deliveryNote"),
                anyMethod: t("store.checkout.methodAny"),
                noShipping: t("store.checkout.noShipping"),
                noneReach: t("store.checkout.noneReach"),
                working: t("common.working"),
              }}
            />
          ) : null}

          <fieldset className="grid gap-3">
            <legend className="text-sm font-semibold text-ink">
              {t("store.checkout.paymentLegend")}
            </legend>
            <p className="text-sm text-ink-muted">
              {t(
                paymentMode === "hosted"
                  ? "store.checkout.paymentHosted"
                  : paymentMode === "manual"
                    ? "store.checkout.paymentManual"
                    : "store.checkout.paymentUnavailable",
              )}
            </p>
            {checkoutSettings.checkoutPayment.mode === "milestones" && checkoutSettings.checkoutPayment.currency === cart.cart.currency ? (
              <div className="grid gap-2 text-sm text-ink">
                <p>{checkoutSettings.checkoutPayment.firstPayment.type === "fixed"
                  ? t("store.checkout.firstFixed", { amount: formatMinor(checkoutSettings.checkoutPayment.firstPayment.amountMinor, cart.cart.currency) })
                  : t("store.checkout.firstPercent", { percent: checkoutSettings.checkoutPayment.firstPayment.sharePpm / 10_000 })}</p>
                <ol className="list-decimal pl-5">
                  {checkoutSettings.checkoutPayment.milestones.map((stage, position) => (
                    <li key={position}>{t("store.checkout.milestoneShare", { percent: stage.sharePpm / 10_000, label: stage.label })}</li>
                  ))}
                </ol>
                <p>{t("store.checkout.laterRelease")}</p>
              </div>
            ) : null}
          </fieldset>

          <label className="grid gap-1 text-sm text-ink-muted sm:max-w-64">
            {t("store.checkout.coupon")}
            <input
              name="couponCode"
              type="text"
              autoComplete="off"
              className={inputClass}
            />
          </label>

          {checkoutSettings.checkoutTerms ? (
            <section className="grid gap-2 rounded-lg border border-rule bg-surface p-4" aria-labelledby="checkout-terms-title">
              <h2 id="checkout-terms-title" className="font-semibold text-ink">{checkoutSettings.checkoutTerms.title}</h2>
              <p className="whitespace-pre-wrap text-sm text-ink">{checkoutSettings.checkoutTerms.body}</p>
              {checkoutSettings.checkoutTerms.href ? <a href={localize(checkoutSettings.checkoutTerms.href)} className="text-sm text-accent underline">{t("store.checkout.readTerms")}</a> : null}
            </section>
          ) : null}
          {checkoutSettings.checkoutTerms ? <input type="hidden" name="termsVersion" value={checkoutSettings.checkoutTerms.version} /> : null}
          {checkoutSettings.checkoutTerms ? <input type="hidden" name="termsHash" value={checkoutTermsHash(checkoutSettings.checkoutTerms.body)} /> : null}
          <label className="flex items-center gap-2 text-sm text-ink">
            <input
              id="checkout-terms"
              name="acceptedTerms"
              type="checkbox"
              required
              className="size-4"
            />
            {checkoutSettings.checkoutTerms ? t("store.checkout.agreeVersion", { title: checkoutSettings.checkoutTerms.title, version: checkoutSettings.checkoutTerms.version }) : t("store.checkout.terms")}
          </label>

          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" className="px-6 py-2.5">
              {t("store.checkout.placeOrder")}
            </Button>
            <a
              href={localize("/cart")}
              className="text-sm text-accent underline-offset-2 hover:underline"
            >
              {t("store.checkout.backToCart")}
            </a>
          </div>
        </form>

        <aside className="grid gap-3 rounded-lg border border-rule bg-surface p-4">
          <h2 className="text-sm font-semibold text-ink">{t("store.checkout.summary")}</h2>
          <ul className="grid list-none gap-2 p-0">
            {cart.lines.map((line) => (
              <li key={line.id} className="flex items-baseline justify-between gap-2 text-sm">
                <span className="text-ink">
                  {line.productName}
                  <span className="ms-1 text-ink-muted">× {line.quantity}</span>
                </span>
                <span className="text-ink-muted">
                  {line.lineTotalMinor === null
                    ? "—"
                    : formatMinor(line.lineTotalMinor, cart.cart.currency)}
                </span>
              </li>
            ))}
          </ul>
          <div className="flex items-baseline justify-between gap-3 border-t border-rule pt-3">
            <span className="text-ink-muted">{t("store.cart.subtotal")}</span>
            <span className="font-bold text-ink">
              {cart.allPriced ? formatMinor(cart.subtotalMinor, cart.cart.currency) : "—"}
            </span>
          </div>
        </aside>
      </div>
    </div>
  );
}

function CheckoutError({ code, t }: { code: string; t: Awaited<ReturnType<typeof getT>> }) {
  const known = [
    "expired",
    "terms",
    "address",
    "validation",
    "permission",
    "conflict",
    "not_found",
    "rate_limited",
    "failed",
  ].includes(code);
  return (
    <div role="alert">
      <Callout tone="danger">
        {t(known ? `store.checkout.error.${code}` : "store.checkout.error.failed")}
      </Callout>
    </div>
  );
}
