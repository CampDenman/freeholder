// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The public order confirmation page (C3.25 slice 3, gap G2 of
// deploy/c324-storefront-parity-2026-09-29.md).
//
// Guest order lookup rides the existing cart-token mechanics: the credential
// that could read the cart can read the order that cart became, nothing
// more. The URL carries the cart id and token; catalog.shopperOrder checks
// the pair exactly like catalog.getCart does, and answers a deliberately
// reduced projection — totals, lines, status, and the existing customer
// invoice-pay link. No contact id, no full address, nothing a leaked link
// should not show. A wrong or missing token is a plain 404, never a hint.
//
// SEO: private utility — noindexed, nofollowed, like checkout.

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Callout } from "@/ui/primitives";
import { shopperOrder } from "@/modules/catalog/service";
import { ServiceError } from "@/core/service";
import { formatMoney } from "@/core/i18n";
import { localePath, localizeCustomerHref } from "@/core/i18n/customer";
import { siteOrigin } from "@/core/seo/origin";
import { composeDocumentTitle } from "@/core/seo/meta";
import { currentBusiness } from "@/core/settings/read";
import { getLocale, getT } from "../../../i18n";

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
  const canonical = `${origin}${localePath("orders/confirm", defaultLocale, defaultLocale)}`;
  return {
    title: composeDocumentTitle(t("store.confirm.title"), business?.name, false),
    robots: { index: false, follow: false },
    alternates: { canonical },
  };
}

export default async function OrderConfirmPage({
  searchParams,
}: {
  searchParams: Promise<Query>;
}) {
  const query = await searchParams;
  const [locale, t, business] = await Promise.all([
    getLocale(),
    getT(),
    currentBusiness(),
  ]);

  const cartId = typeof query.cart === "string" ? query.cart : "";
  const token = typeof query.t === "string" ? query.t : "";
  if (!cartId || !token) notFound();

  // One wrong answer for "no such order" and "not your order": the services
  // already refuse to distinguish them for anonymous callers.
  const view = await shopperOrder
    .call({ cartId, cartToken: token }, { kind: "anonymous" })
    .catch((error: unknown) => {
      if (error instanceof ServiceError && ["permission", "not_found"].includes(error.code)) {
        notFound();
      }
      throw error;
    });

  const localize = (href: string) =>
    business ? localizeCustomerHref(href, locale, business) : href;
  const formatMinor = (minor: number) =>
    formatMoney(minor, view.order.currency, locale);
  const placed = view.order.createdAt.toLocaleDateString(locale, {
    dateStyle: "medium",
  });
  const invoiceOpen = view.payHref !== null;

  return (
    <div className="grid gap-6">
      <header className="grid gap-2">
        <h1 className="text-3xl font-bold tracking-tight text-balance text-ink">
          {t("store.confirm.heading")}
        </h1>
        <p className="text-ink-muted">
          {t("store.confirm.placed", { date: placed })} ·{" "}
          {t(`store.confirm.status.${view.order.status}`)}
        </p>
      </header>

      <div className="grid gap-3 rounded-lg border border-rule bg-surface p-4">
        <ul className="grid list-none gap-2 p-0">
          {view.lines.map((line) => (
            <li key={`${line.sku}-${line.quantity}`} className="flex items-baseline justify-between gap-2 text-sm">
              <span className="text-ink">
                {line.productName}
                <span className="ms-1 text-ink-muted">× {line.quantity}</span>
              </span>
              <span className="text-ink-muted">{formatMinor(line.lineTotalMinor)}</span>
            </li>
          ))}
        </ul>
        <dl className="grid gap-1 border-t border-rule pt-3 text-sm">
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-ink-muted">{t("store.cart.subtotal")}</dt>
            <dd className="text-ink">{formatMinor(view.order.subtotalMinor)}</dd>
          </div>
          {view.order.discountMinor > 0 ? (
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-ink-muted">{t("store.confirm.discount")}</dt>
              <dd className="text-ink">−{formatMinor(view.order.discountMinor)}</dd>
            </div>
          ) : null}
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-ink-muted">{t("store.confirm.shipping")}</dt>
            <dd className="text-ink">
              {view.order.shippingMinor === 0
                ? t("store.confirm.free")
                : formatMinor(view.order.shippingMinor)}
              {view.shippingMethodName ? ` · ${view.shippingMethodName}` : ""}
            </dd>
          </div>
          {view.order.taxMinor > 0 ? (
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-ink-muted">{t("store.confirm.tax")}</dt>
              <dd className="text-ink">{formatMinor(view.order.taxMinor)}</dd>
            </div>
          ) : null}
          <div className="flex items-baseline justify-between gap-3 border-t border-rule pt-2 text-base font-bold">
            <dt className="text-ink">{t("store.confirm.total")}</dt>
            <dd className="text-ink">{formatMinor(view.order.totalMinor)}</dd>
          </div>
        </dl>
      </div>

      {view.order.status === "pending_payment" && view.invoice && view.invoice.number ? (
        <div className="grid gap-2">
          {invoiceOpen && view.payHref ? (
            <a
              href={localize(view.payHref)}
              className="inline-flex w-fit items-center rounded-md bg-accent px-5 py-2.5 text-sm font-semibold text-on-accent shadow-press"
            >
              {t("store.confirm.payNow")}
            </a>
          ) : (
            <Callout tone="neutral">{t("store.confirm.paidNote")}</Callout>
          )}
        </div>
      ) : view.order.status === "paid" ? (
        <Callout tone="success">{t("store.confirm.paidNote")}</Callout>
      ) : null}

      <section className="grid gap-2" aria-labelledby="confirm-next">
        <h2 id="confirm-next" className="text-sm font-semibold text-ink">
          {t("store.confirm.nextLegend")}
        </h2>
        <p className="text-sm text-ink-muted">{t("store.confirm.nextSteps")}</p>
        <a
          href={localize("/portal")}
          className="text-sm text-accent underline-offset-2 hover:underline"
        >
          {t("store.confirm.portal")}
        </a>
      </section>
    </div>
  );
}
