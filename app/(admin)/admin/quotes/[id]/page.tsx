// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// One quote, every version of it, and the conversation (C6.12, §4.3).
//
// The line editor is a *draft* editor or a *revision* editor depending on the
// state, and the screen says which — because the difference matters to the
// customer. A draft is private; a revision is a new offer they can see. The
// service refuses the wrong one either way, so this only has to be honest
// about what the button does.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Button, Card, CardBody, CardHeader, Pill, type Tone } from "@/ui/primitives";
import { formatMoney } from "@/core/i18n";
import { minorToDecimal } from "@/adapters/payments/currency";
import { currentBusiness } from "@/core/settings/read";
import { getQuote } from "@/modules/quotes/service";
import { getT } from "../../../../i18n";
import { requireStaffActor } from "../../guard";
import { domainOrNull } from "../../../read-helpers";
import {
  replyToQuoteAction,
  reviseQuoteAction,
  sendQuoteAction,
  setQuoteItemsAction,
} from "../../../quote-actions";

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

/** Enough blank rows to write a quote without reloading, and no more. */
const BLANK_ROWS = 6;

export default async function QuotePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const actor = await requireStaffActor("quotes");
  const { id } = await params;
  const [t, business, quote, query] = await Promise.all([
    getT(),
    currentBusiness(),
    domainOrNull(getQuote.call({ id }, actor)),
    searchParams,
  ]);
  if (!quote) notFound();

  const locale = business?.defaultLocale ?? "en";
  const money = (minor: number) => formatMoney(minor, quote.currency, locale);
  const isDraft = quote.status === "draft";
  const editable = quote.status !== "accepted";
  const rows = [
    ...quote.items.map((line) => ({
      description: line.description,
      // Integer minor units to a decimal string without floating point, and
      // per currency rather than per hundred — a yen quote has no pence.
      price: minorToDecimal(line.unitPriceMinor, quote.currency),
      optional: line.optional,
    })),
    ...Array.from({ length: BLANK_ROWS }, () => ({
      description: "",
      price: "",
      optional: false,
    })),
  ];

  return (
    <div className="grid gap-6">
      <div>
        <a href="/admin/quotes" className="text-sm text-ink-muted">
          {t("quotes.back")}
        </a>
        <h1 className="mt-2 flex flex-wrap items-center gap-2 text-xl font-bold tracking-tight">
          {quote.reference} · {quote.title}
          <Pill tone={STATUS_TONES[quote.status] ?? "neutral"}>
            {t(`quote.status.${quote.status}`)}
          </Pill>
          {quote.version > 1 ? (
            <Pill tone="neutral">
              {t("quote.version", { version: String(quote.version) })}
            </Pill>
          ) : null}
        </h1>
        <p className="mt-1 text-sm tabular-nums text-ink-muted">
          {t("quote.totalIs", { total: money(quote.totals.totalMinor) })}
        </p>
      </div>

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

      {editable ? (
        <Card>
          <CardHeader title={isDraft ? t("quotes.lines") : t("quotes.revise")} />
          <CardBody>
            {/* The same fields, a different verb. A draft is private; a
                revision is a new offer the customer can see, and the screen
                says which rather than leaving them to find out. */}
            <form
              action={isDraft ? setQuoteItemsAction : reviseQuoteAction}
              className="grid gap-2"
            >
              <input type="hidden" name="id" value={quote.id} />
              {rows.map((line, index) => (
                <div key={index} className="flex flex-wrap items-end gap-2">
                  <label className="grid grow gap-1 text-sm">
                    <span className="sr-only">{t("quotes.field.line")}</span>
                    <input
                      name="description"
                      defaultValue={line.description}
                      placeholder={t("quotes.field.line")}
                      className="w-full rounded-md border border-rule bg-field px-2 py-1 text-sm"
                    />
                  </label>
                  <label className="grid gap-1 text-sm">
                    <span className="sr-only">{t("quotes.field.price")}</span>
                    <input
                      name="unitPrice"
                      inputMode="decimal"
                      defaultValue={line.price}
                      placeholder={t("quotes.field.price")}
                      className="w-28 rounded-md border border-rule bg-field px-2 py-1 text-sm tabular-nums"
                    />
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="optional" defaultChecked={line.optional} />
                    <span className="text-ink-muted">{t("quote.optional")}</span>
                  </label>
                </div>
              ))}
              <div>
                <Button type="submit" variant="quiet">
                  {isDraft ? t("quotes.action.saveLines") : t("quotes.action.revise")}
                </Button>
              </div>
            </form>
            <p className="max-w-prose text-sm text-ink-muted">
              {isDraft ? t("quotes.linesHint") : t("quotes.reviseHint")}
            </p>
          </CardBody>
        </Card>
      ) : null}

      {quote.status !== "accepted" ? (
        <Card>
          <CardHeader title={t("quotes.sendIt")} />
          <CardBody>
            <form action={sendQuoteAction}>
              <input type="hidden" name="id" value={quote.id} />
              <Button type="submit">{t("quotes.action.send")}</Button>
            </form>
            {/* The link itself is not printed here. It is a credential, and a
                screen is the easiest place for one to be photographed. */}
            <p className="max-w-prose text-sm text-ink-muted">{t("quotes.sendHint")}</p>
          </CardBody>
        </Card>
      ) : null}

      {quote.history.length > 0 ? (
        <Card>
          <CardHeader title={t("quotes.earlier")} />
          <CardBody>
            <ul className="grid list-none gap-1 p-0 text-sm">
              {quote.history.map((line) => (
                <li key={line.id} className="flex justify-between gap-3 text-ink-muted">
                  <span>
                    {t("quote.version", { version: String(line.version) })} ·{" "}
                    {line.description}
                  </span>
                  <span className="tabular-nums">{money(line.unitPriceMinor)}</span>
                </li>
              ))}
            </ul>
            <p className="max-w-prose text-sm text-ink-muted">{t("quotes.earlierHint")}</p>
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
                      : (quote.contactId ? t("quotes.theCustomer") : "")}
                  </span>
                  <p className="max-w-prose whitespace-pre-wrap">{message.body}</p>
                </li>
              ))}
            </ul>
          )}
          <form action={replyToQuoteAction} className="grid gap-2">
            <input type="hidden" name="id" value={quote.id} />
            <label className="grid gap-1 text-sm">
              <span className="text-ink-muted">{t("quotes.field.reply")}</span>
              <textarea
                name="body"
                required
                rows={3}
                className="max-w-prose rounded-md border border-rule bg-field px-2 py-1 text-sm"
              />
            </label>
            <div>
              <Button type="submit" variant="quiet">
                {t("quotes.action.reply")}
              </Button>
            </div>
          </form>
        </CardBody>
      </Card>
    </div>
  );
}
