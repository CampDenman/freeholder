// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import type { getCustomerInvoice } from "@/modules/invoicing/customer-service";
import { formatMoney, type Translate } from "@/core/i18n";
import { Callout, Card, CardBody, Pill } from "@/ui/primitives";
import { SkipLink } from "@/ui/SkipLink";
import { payInvoiceAction } from "./actions";
import { PaymentButton } from "./PaymentButton";

type Invoice = Awaited<ReturnType<typeof getCustomerInvoice.call>>;
export function InvoiceView({ invoice, token, t, locale, timezone, businessName, checkout, error, backHref }: {
  invoice: Invoice; token?: string; t: Translate; locale: string; timezone: string;
  businessName: string; checkout?: string; error?: string; backHref: string;
}) {
  const money = (amount: number) => formatMoney(amount, invoice.currency, locale);
  const due = invoice.dueAt && new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: timezone }).format(invoice.dueAt);
  return (
    <div className="mx-auto max-w-3xl p-6">
      <SkipLink target="main">{t("a11y.skipToContent")}</SkipLink>
      <main id="main" tabIndex={-1} className="grid gap-6">
        <header className="grid gap-2">
          <p className="text-sm text-ink-muted">{businessName}</p>
          <h1 className="text-2xl font-bold">{t("customerInvoice.title", { number: invoice.number })}</h1>
          <div><Pill tone={invoice.status === "paid" ? "success" : "neutral"}>{t(`invoices.status.${invoice.status}`)}</Pill></div>
          {due ? <p className="text-sm text-ink-muted">{t("customerInvoice.due", { date: due })}</p> : null}
        </header>
        {error ? <div role="alert"><Callout tone="danger">{t("customerInvoice.failed")}</Callout></div> : null}
        {checkout === "cancelled" ? <Callout tone="warning">{t("customerInvoice.cancelled")}</Callout> : null}
        {checkout === "offline" && invoice.canPay ? <Callout tone="neutral">{t("customerInvoice.offlineInstructions")}</Callout> : null}
        <Card><CardBody>
          <ul className="grid list-none gap-4 p-0">
            {invoice.lines.map((line) => <li key={line.id} className="flex flex-wrap justify-between gap-2 border-b border-rule pb-3">
              <span>{line.description} <span className="text-ink-muted">({new Intl.NumberFormat(locale).format(line.quantityMicros / 1_000_000)})</span></span>
              <span className="font-mono">{money(line.totalMinor)}</span>
            </li>)}
          </ul>
          <dl className="mt-5 grid gap-2">
            {([
              ["invoices.subtotal", invoice.subtotalMinor], ["invoices.discount", invoice.discountMinor],
              ["invoices.shippingAmount", invoice.shippingMinor], ["invoices.taxAmount", invoice.taxMinor],
              ["invoices.total", invoice.totalMinor], ["invoices.paid", invoice.paidMinor],
              ["customerInvoice.balance", invoice.totalMinor - invoice.paidMinor],
            ] as const).map(([label, amount]) => <div key={label} className="flex justify-between gap-4"><dt>{t(label)}</dt><dd className="font-mono">{money(amount)}</dd></div>)}
          </dl>
          {invoice.requiredTaxLegend ? <p className="mt-4 text-sm text-ink-muted">{invoice.requiredTaxLegend}</p> : null}
          {invoice.memo ? <p className="mt-4 whitespace-pre-wrap text-sm">{invoice.memo}</p> : null}
        </CardBody></Card>
        {invoice.canPay ? invoice.paymentMode === "unavailable" ? <Callout tone="warning">{t("customerInvoice.unavailable")}</Callout> : (
          <form action={payInvoiceAction} className="grid justify-items-start gap-2">
            <input type="hidden" name="id" value={invoice.id} />
            {token ? <input type="hidden" name="token" value={token} /> : null}
            <PaymentButton label={t(invoice.paymentMode === "manual" ? "customerInvoice.offline" : "customerInvoice.pay")} pendingLabel={t("common.working")} />
            <p className="text-sm text-ink-muted">{t(invoice.paymentMode === "manual" ? "customerInvoice.offlineHint" : "customerInvoice.hostedHint")}</p>
          </form>
        ) : <Callout tone="neutral">{t("customerInvoice.closed")}</Callout>}
        <a href={backHref} className="text-sm text-accent underline">{t("customerInvoice.back")}</a>
      </main>
    </div>
  );
}
