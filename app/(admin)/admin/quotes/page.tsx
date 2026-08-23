// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The quote pipeline (C6.12, MASTER.md §4.3).
//
// Ordered by what needs the owner rather than by date: a customer who has
// asked a question is waiting on a reply, and one who has viewed and gone
// quiet is the follow-up that wins the job. Sorting by identifier would bury
// both.
import type { Metadata } from "next";
import { Button, Card, CardBody, CardHeader, Pill, type Tone } from "@/ui/primitives";
import { formatMoney } from "@/core/i18n";
import { currentBusiness } from "@/core/settings/read";
import { listContacts } from "@/core/contacts/service";
import { listQuotes, QUOTE_STATUSES } from "@/modules/quotes/service";
import { defaultView, meaningfulParams, toQueryString } from "@/core/views/service";
import { redirect } from "next/navigation";
import { ViewBar } from "../ViewBar";
import { getT } from "../../../i18n";
import { requireStaffActor } from "../guard";
import { domainOrNull } from "../../read-helpers";
import { createQuoteAction } from "../../quote-actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

const STATUS_TONES: Record<string, Tone> = {
  draft: "neutral",
  sent: "accent",
  viewed: "accent",
  negotiating: "warning",
  accepted: "success",
  declined: "neutral",
  expired: "neutral",
};

/** Waiting on the owner first, then waiting on the customer, then history. */
const ORDER = ["negotiating", "viewed", "sent", "draft", "accepted", "declined", "expired"];

export default async function QuotesPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string; status?: string }>;
}) {
  const actor = await requireStaffActor("quotes");
  const query = await searchParams;
  const applied = meaningfulParams(query);

  // Nothing asked for: open this person's kept first screen by navigating to
  // it, so the address bar always describes the page (C7.06).
  if (Object.keys(applied).length === 0) {
    const preferred = await defaultView.call({ entity: "quotes" }, actor);
    const preset = preferred ? toQueryString(preferred.filters) : "";
    if (preset) redirect(`/admin/quotes?${preset}`);
  }

  const status = QUOTE_STATUSES.find((one) => one === query.status);
  const [t, business, quotes, people] = await Promise.all([
    getT(),
    currentBusiness(),
    domainOrNull(listQuotes.call({ status, limit: 100 }, actor)),
    domainOrNull(listContacts.call({ limit: 100 }, actor)),
  ]);

  const locale = business?.defaultLocale ?? "en";
  const money = (minor: number, currency: string) => formatMoney(minor, currency, locale);
  const sorted = [...(quotes ?? [])].sort(
    (a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status),
  );

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight">{t("quotes.title")}</h1>
        <p className="mt-1 max-w-prose text-sm text-ink-muted">{t("quotes.intro")}</p>
      </div>

      {/* Filtering is a GET form and a saved view is a named URL, so the two
          are the same mechanism (C7.06). */}
      <ViewBar actor={actor} entity="quotes" params={applied} />

      <form method="get" className="flex flex-wrap items-end gap-3">
        <label className="grid gap-1 text-sm">
          <span className="text-ink-muted">{t("quotes.filter.status")}</span>
          <select
            name="status"
            defaultValue={status ?? ""}
            className="rounded-md border border-rule bg-field px-2 py-1 text-sm"
          >
            <option value="">{t("quotes.filter.any")}</option>
            {QUOTE_STATUSES.map((one) => (
              <option key={one} value={one}>
                {t(`quote.status.${one}`)}
              </option>
            ))}
          </select>
        </label>
        <Button type="submit" variant="quiet">
          {t("quotes.filter.apply")}
        </Button>
      </form>

      {query.saved ? (
        <p className="rounded-md border border-success bg-success-soft px-3 py-2 text-sm text-success">
          {t("quotes.saved")}
        </p>
      ) : null}
      {query.error ? (
        <p className="rounded-md border border-danger bg-danger-soft px-3 py-2 text-sm text-danger">
          {query.error.includes(" ") ? query.error : t("quotes.failed")}
        </p>
      ) : null}

      <Card>
        <CardHeader title={t("quotes.pipeline")} />
        <CardBody>
          {quotes === null ? (
            <p className="text-sm text-danger">{t("quotes.unavailable")}</p>
          ) : sorted.length === 0 ? (
            <p className="max-w-prose text-sm text-ink-muted">{t("quotes.empty")}</p>
          ) : (
            <ul className="grid list-none gap-2 p-0">
              {sorted.map((quote) => (
                <li
                  key={quote.id}
                  className="flex flex-wrap items-center gap-3 rounded-md border border-rule p-3"
                >
                  <a href={`/admin/quotes/${quote.id}`} className="font-medium underline">
                    {quote.reference}
                  </a>
                  <span>{quote.title}</span>
                  <Pill tone={STATUS_TONES[quote.status] ?? "neutral"}>
                    {t(`quote.status.${quote.status}`)}
                  </Pill>
                  <span className="text-sm text-ink-muted">
                    {quote.contactName ?? quote.contactEmail ?? ""}
                  </span>
                  <span className="ms-auto text-sm tabular-nums">
                    {money(quote.totalMinor, quote.currency)}
                  </span>
                  {quote.version > 1 ? (
                    <Pill tone="neutral">
                      {t("quote.version", { version: String(quote.version) })}
                    </Pill>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("quotes.draft")} />
        <CardBody>
          <form action={createQuoteAction} className="flex flex-wrap items-end gap-3">
            <label className="grid gap-1 text-sm">
              <span className="text-ink-muted">{t("quotes.field.customer")}</span>
              <select
                name="contactId"
                required
                className="rounded-md border border-rule bg-field px-2 py-1 text-sm"
              >
                {(people?.rows ?? []).map((contact) => (
                  <option key={contact.id} value={contact.id}>
                    {contact.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-sm">
              <span className="text-ink-muted">{t("quotes.field.title")}</span>
              <input
                name="title"
                required
                className="rounded-md border border-rule bg-field px-2 py-1 text-sm"
              />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="text-ink-muted">{t("quotes.field.validUntil")}</span>
              <input
                type="date"
                name="validUntil"
                className="rounded-md border border-rule bg-field px-2 py-1 text-sm"
              />
            </label>
            <Button type="submit">{t("quotes.action.draft")}</Button>
          </form>
          <p className="max-w-prose text-sm text-ink-muted">{t("quotes.draftHint")}</p>
        </CardBody>
      </Card>
    </div>
  );
}
