// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// A quote, as a business partner sees it (C9.34, MASTER.md §34).
//
// View only. The prospect's token is the authorisation to accept; this page
// is deliberately a different address so a forwarded partner link cannot
// spend the offer.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Card, CardBody, CardHeader, Pill, type Tone } from "@/ui/primitives";
import { SkipLink } from "@/ui/SkipLink";
import { formatMoney } from "@/core/i18n";
import { currentBusiness } from "@/core/settings/read";
import { quoteByPartnerToken } from "@/modules/quotes/service";
import { getT } from "../../../../i18n";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return {
    title: t("quote.title"),
    robots: { index: false, follow: false },
    referrer: "no-referrer",
  };
}

const STATUS_TONES: Record<string, Tone> = {
  sent: "accent",
  viewed: "accent",
  negotiating: "warning",
  accepted: "success",
  declined: "neutral",
  expired: "neutral",
};

export default async function QuotePartnerPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const [t, business, quote] = await Promise.all([
    getT(),
    currentBusiness(),
    quoteByPartnerToken.call({ token }, { kind: "anonymous" }),
  ]);
  if (!quote) notFound();

  const locale = business?.defaultLocale ?? "en";
  const money = (minor: number) => formatMoney(minor, quote.currency, locale);
  const until = quote.validUntil
    ? new Intl.DateTimeFormat(locale, { dateStyle: "long" }).format(
        new Date(quote.validUntil),
      )
    : null;

  return (
    <div className="mx-auto grid max-w-3xl gap-6 p-6">
      <SkipLink target="main">{t("a11y.skipToContent")}</SkipLink>
      <main id="main" className="grid gap-6">
        <div>
          <h1 className="flex flex-wrap items-center gap-2 text-xl font-bold tracking-tight">
            {quote.title}
            <Pill tone={STATUS_TONES[quote.status] ?? "neutral"}>
              {t(`quote.status.${quote.status}`)}
            </Pill>
          </h1>
          <p className="mt-1 text-sm text-ink-muted">
            {t("quote.from", {
              business: business?.name ?? "",
              reference: quote.reference,
            })}
          </p>
          {until ? (
            <p className="text-sm text-ink-muted">{t("quote.validUntil", { until })}</p>
          ) : null}
          <p className="mt-2 text-sm text-ink-muted">{t("quote.partner.viewOnly")}</p>
        </div>

        <Card>
          <CardHeader title={t("quote.whatIsIncluded")} />
          <CardBody>
            <ul className="grid list-none gap-2 p-0">
              {quote.items.map((line) => (
                <li
                  key={line.id}
                  className="flex flex-wrap items-center justify-between gap-3 border-b border-rule pb-2 text-sm"
                >
                  <span className="flex items-center gap-2">
                    <span>{line.description}</span>
                    {line.optional ? (
                      <Pill tone="neutral">{t("quote.optional")}</Pill>
                    ) : null}
                  </span>
                  <span className="tabular-nums">
                    {money(
                      Math.round((line.unitPriceMinor * line.quantityMicros) / 1_000_000),
                    )}
                  </span>
                </li>
              ))}
            </ul>
            <p className="flex justify-between text-base font-semibold">
              <span>{t("quote.total")}</span>
              <span className="tabular-nums">{money(quote.totals.totalMinor)}</span>
            </p>
            {quote.depositMinor ? (
              <p className="max-w-prose text-sm text-ink-muted">
                {t("quote.deposit", { deposit: money(quote.depositMinor) })}
              </p>
            ) : null}
          </CardBody>
        </Card>

        {quote.terms ? (
          <Card>
            <CardHeader title={t("quote.terms")} />
            <CardBody>
              <div className="max-w-prose whitespace-pre-wrap text-sm leading-relaxed">
                {quote.terms}
              </div>
            </CardBody>
          </Card>
        ) : null}
      </main>
    </div>
  );
}
