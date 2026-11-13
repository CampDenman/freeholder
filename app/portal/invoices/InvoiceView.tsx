// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { invoiceOutstanding } from "@/modules/invoicing/invoice-balance";
import type { getCustomerInvoice } from "@/modules/invoicing/customer-service";
import { invoiceAppReturnHref } from "@/modules/invoicing/customer-tokens";
import { formatMoney, type Translate } from "@/core/i18n";
import { Callout, Card, CardBody, Pill } from "@/ui/primitives";
import { SkipLink } from "@/ui/SkipLink";
import { payInvoiceAction } from "./actions";
import { PaymentButton } from "./PaymentButton";
import { InvoiceIssuer } from "./InvoiceIssuer";
import { RefundStatusList } from "./RefundStatusList";

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
          {invoice.merchants.length ? <p className="text-sm text-ink-muted">{t("customerInvoice.merchants")}</p> : <InvoiceIssuer issuer={invoice} businessName={businessName} locale={locale} t={t}/>}
          <h1 className="text-2xl font-bold">{t("customerInvoice.title", { number: invoice.number })}</h1>
          <div><Pill tone={invoice.status === "paid" ? "success" : "neutral"}>{t(`invoices.status.${invoice.status}`)}</Pill></div>
          {due ? <p className="text-sm text-ink-muted">{t("customerInvoice.due", { date: due })}</p> : null}
        </header>
        {error ? <div role="alert"><Callout tone="danger">{t("customerInvoice.failed")}</Callout></div> : null}
        {checkout === "cancelled" ? <Callout tone="warning">{t("customerInvoice.cancelled")}</Callout> : null}
        {checkout === "offline" && invoice.canPay ? <Callout tone="neutral">{t("customerInvoice.offlineInstructions")}</Callout> : null}
        {invoice.merchants.length ? <section className="grid gap-4" aria-label={t("customerInvoice.merchants")}>
          <p className="text-sm text-ink-muted">{t("customerInvoice.merchantPartsHint")}</p>
          {invoice.merchants.map(merchant => <Card key={merchant.allocationId}><CardBody>
            <InvoiceIssuer issuer={{issuerIsMerchant:true,issuerName:merchant.merchantName,issuerSupport:merchant.merchantSupport}} businessName={businessName} locale={locale} t={t}/>
            <dl className="mt-3 grid gap-2">
              {([["invoices.subtotal",merchant.subtotalMinor],["invoices.discount",merchant.discountMinor],["invoices.shippingAmount",merchant.shippingMinor],["invoices.taxAmount",merchant.taxMinor],["invoices.total",merchant.totalMinor],["invoices.paid",merchant.paidMinor],["invoices.refunded",merchant.refundedMinor]] as const).map(([label,amount])=><div key={label} className="flex justify-between gap-4"><dt>{t(label)}</dt><dd className="font-mono">{money(amount)}</dd></div>)}
            </dl>
          </CardBody></Card>)}
        </section> : null}
        <Card><CardBody>
          <ul className="grid list-none gap-4 p-0">
            {invoice.lines.map((line) => <li key={line.id} className="flex flex-wrap justify-between gap-2 border-b border-rule pb-3">
              <span>{line.description} <span className="text-ink-muted">({new Intl.NumberFormat(locale).format(line.quantityMicros / 1_000_000)})</span>
                {invoice.merchants.length ? <small className="block text-ink-muted"><bdi>{invoice.merchants.find(merchant=>merchant.lineIds.includes(line.id))?.merchantName??t("customerInvoice.merchantUnavailable")}</bdi></small> : null}
              </span>
              <span className="font-mono">{money(line.amountMinor)}</span>
            </li>)}
          </ul>
          <dl className="mt-5 grid gap-2">
            {([
              ["invoices.subtotal", invoice.subtotalMinor], ["invoices.discount", invoice.discountMinor],
              ["invoices.shippingAmount", invoice.shippingMinor], ["invoices.taxAmount", invoice.taxMinor],
              ["invoices.total", invoice.totalMinor], ["invoices.paid", invoice.paidMinor],
              ["customerInvoice.credited", invoice.creditedMinor],
              ["customerInvoice.balance", invoiceOutstanding(invoice)],
            ] as const).map(([label, amount]) => <div key={label} className="flex justify-between gap-4"><dt>{t(label)}</dt><dd className="font-mono">{money(amount)}</dd></div>)}
            {invoice.nextPaymentMinor !== null ? <div className="flex justify-between gap-4 font-semibold"><dt>{t("customerInvoice.nextPayment")}</dt><dd className="font-mono">{money(invoice.nextPaymentMinor)}</dd></div> : null}
          </dl>
          {invoice.requiredTaxLegend ? <p className="mt-4 text-sm text-ink-muted">{invoice.requiredTaxLegend}</p> : null}
          {invoice.memo ? <p className="mt-4 whitespace-pre-wrap text-sm">{invoice.memo}</p> : null}
        </CardBody></Card>
        <RefundStatusList refunds={invoice.refunds} t={t} locale={locale} />
        {invoice.canPay ? invoice.paymentMode === "unavailable" ? <Callout tone="warning">{t("customerInvoice.unavailable")}</Callout> : (
          <form action={payInvoiceAction} className="grid justify-items-start gap-2">
            <input type="hidden" name="id" value={invoice.id} />
            {token ? <input type="hidden" name="token" value={token} /> : null}
            {invoice.saveMethodRequired ? <label className="flex items-start gap-2"><input type="checkbox" name="saveMethodConsent" value="yes" required /><span>{t("memberships.saveConsent")}</span></label> : null}
            <PaymentButton label={t(invoice.paymentMode === "manual" ? "customerInvoice.offline" : "customerInvoice.payAmount", { amount: money(invoice.nextPaymentMinor ?? 0) })} pendingLabel={t("common.working")} />
            <p className="text-sm text-ink-muted">{t(invoice.paymentMode === "manual" ? "customerInvoice.offlineHint" : "customerInvoice.hostedHint")}</p>
          </form>
        ) : <Callout tone="neutral">{t(invoice.awaitingRelease ? "customerInvoice.awaitingRelease" : "customerInvoice.closed")}</Callout>}
        <a href={backHref} className="text-sm text-accent underline">{t("customerInvoice.back")}</a>
        <a href={invoiceAppReturnHref()} className="text-sm text-accent underline">{t("app.invoice.return")}</a>
      </main>
    </div>
  );
}
