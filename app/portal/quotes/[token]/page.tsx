// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// A quote, as the person it was sent to sees it (C6.12, MASTER.md §4.3).
//
// The whole page is the offer. Optional lines are real controls rather than
// small print, because §4.3 says the client can toggle them and a quote whose
// extras cannot actually be turned off is a price list with checkboxes drawn
// on it.
//
// Opening the page records the first view — the owner's first signal that the
// offer landed — through a mutation the page calls once rather than as a
// side-effect of reading, so nothing a cache does can fabricate it.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Button, Card, CardBody, CardHeader, Pill, type Tone } from "@/ui/primitives";
import { SkipLink } from "@/ui/SkipLink";
import { formatMoney } from "@/core/i18n";
import { currentBusiness } from "@/core/settings/read";
import { markQuoteViewed, quoteByToken } from "@/modules/quotes/service";
import { getT } from "../../../i18n";
import {
  acceptQuoteAction,
  chooseOptionsAction,
  declineQuoteAction,
  askAboutQuoteAction,
} from "../actions";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return {
    title: t("quote.title"),
    // The URL is the credential: never indexed, never passed on as a referrer.
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

export default async function QuotePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const { token } = await params;
  const [t, business, quote, query] = await Promise.all([
    getT(),
    currentBusiness(),
    quoteByToken.call({ token }, { kind: "anonymous" }),
    searchParams,
  ]);
  if (!quote) notFound();

  // Recorded here rather than inside the read, so viewing a quote in the admin
  // never marks it and no caching layer can invent the moment.
  if (quote.open) {
    await markQuoteViewed.call({ token }, { kind: "anonymous" }).catch(() => undefined);
  }

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
        </div>

        {query.saved === "accepted" ? (
          <p className="rounded-md border border-success bg-success-soft px-3 py-2 text-sm text-success">
            {t("quote.acceptedThanks")}
          </p>
        ) : null}
        {query.error ? (
          <p className="rounded-md border border-danger bg-danger-soft px-3 py-2 text-sm text-danger">
            {query.error.includes(" ") ? query.error : t("quote.failed")}
          </p>
        ) : null}

        <Card>
          <CardHeader title={t("quote.whatIsIncluded")} />
          <CardBody>
            <form action={chooseOptionsAction} className="grid gap-3">
              <input type="hidden" name="token" value={token} />
              <ul className="grid list-none gap-2 p-0">
                {quote.items.map((line) => (
                  <li
                    key={line.id}
                    className="flex flex-wrap items-center justify-between gap-3 border-b border-rule pb-2 text-sm"
                  >
                    <span className="flex items-center gap-2">
                      {line.optional && quote.open ? (
                        <input
                          type="checkbox"
                          name="selectedItemIds"
                          value={line.id}
                          defaultChecked={line.selected}
                        />
                      ) : null}
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
              {quote.open && quote.items.some((line) => line.optional) ? (
                <div>
                  <Button type="submit" variant="quiet">
                    {t("quote.action.updateOptions")}
                  </Button>
                </div>
              ) : null}
            </form>
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
              {/* The snapshot, rendered as written: this is what they would be
                  agreeing to, and running it through a formatter would mean
                  the page could show something the acceptance does not cover. */}
              <div className="max-w-prose whitespace-pre-wrap text-sm leading-relaxed">
                {quote.terms}
              </div>
            </CardBody>
          </Card>
        ) : null}

        {quote.open ? (
          <Card>
            <CardHeader title={t("quote.decide")} />
            <CardBody>
              <form action={acceptQuoteAction} className="grid gap-3">
                <input type="hidden" name="token" value={token} />
                <label className="grid gap-1 text-sm">
                  <span className="text-ink-muted">{t("quote.field.name")}</span>
                  <input
                    name="acceptedName"
                    required
                    autoComplete="name"
                    className="max-w-sm rounded-md border border-rule bg-field px-2 py-1 text-sm"
                  />
                </label>
                {/* Never disabled on what a field contains: the control acts,
                    and the handler validates and says why (§15.10). */}
                <div>
                  <Button type="submit">{t("quote.action.accept")}</Button>
                </div>
              </form>
              <form action={declineQuoteAction} className="grid gap-2">
                <input type="hidden" name="token" value={token} />
                <label className="grid gap-1 text-sm">
                  <span className="text-ink-muted">{t("quote.field.reason")}</span>
                  <input
                    name="reason"
                    className="max-w-sm rounded-md border border-rule bg-field px-2 py-1 text-sm"
                  />
                </label>
                <div>
                  <Button type="submit" variant="quiet">
                    {t("quote.action.decline")}
                  </Button>
                </div>
              </form>
            </CardBody>
          </Card>
        ) : null}

        <Card>
          <CardHeader title={t("quote.conversation")} />
          <CardBody>
            {quote.messages.length === 0 ? (
              <p className="max-w-prose text-sm text-ink-muted">{t("quote.noMessages")}</p>
            ) : (
              <ul className="grid list-none gap-2 p-0">
                {quote.messages.map((message) => (
                  <li key={message.id} className="rounded-md border border-rule p-2 text-sm">
                    <span className="text-ink-muted">
                      {message.author === "owner"
                        ? (business?.name ?? t("quote.theBusiness"))
                        : t("quote.you")}
                    </span>
                    <p className="max-w-prose whitespace-pre-wrap">{message.body}</p>
                  </li>
                ))}
              </ul>
            )}
            {quote.open ? (
              <form action={askAboutQuoteAction} className="grid gap-2">
                <input type="hidden" name="token" value={token} />
                <label className="grid gap-1 text-sm">
                  <span className="text-ink-muted">{t("quote.field.message")}</span>
                  <textarea
                    name="body"
                    required
                    rows={3}
                    className="max-w-prose rounded-md border border-rule bg-field px-2 py-1 text-sm"
                  />
                </label>
                <div>
                  <Button type="submit" variant="quiet">
                    {t("quote.action.ask")}
                  </Button>
                </div>
              </form>
            ) : null}
          </CardBody>
        </Card>
      </main>
    </div>
  );
}
