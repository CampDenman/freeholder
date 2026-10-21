// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ServiceError } from "@/core/service";
import { formatMoney } from "@/core/i18n";
import { localizeCustomerHref } from "@/core/i18n/customer";
import { currentBusiness } from "@/core/settings/read";
import { customerPaymentReceipt } from "@/modules/invoicing/customer-service";
import { invoiceAppReturnHref } from "@/modules/invoicing/customer-tokens";
import { Callout } from "@/ui/primitives";
import { getLocale, getT } from "../../../../i18n";
import { confirmInvoicePaymentAction } from "../../actions";
import { PaymentButton } from "../../PaymentButton";
import { SkipLink } from "@/ui/SkipLink";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("customerInvoice.confirmation"), robots: { index: false, follow: false }, referrer: "no-referrer" };
}
export default async function InvoiceConfirmation({ params, searchParams }: {
  params: Promise<{ token: string }>; searchParams: Promise<{ error?: string }>;
}) {
  const [{ token }, query, t, locale, business] = await Promise.all([params, searchParams, getT(), getLocale(), currentBusiness()]);
  const payment = await customerPaymentReceipt.call({ token }, { kind: "anonymous" }).catch((error: unknown) => {
    if (error instanceof ServiceError && ["not_found", "validation"].includes(error.code)) notFound();
    throw error;
  });
  const pending = payment.status === "processing" || payment.status === "created";
  return <main id="main" tabIndex={-1} className="mx-auto grid max-w-xl gap-5 p-6">
    <SkipLink target="main">{t("a11y.skipToContent")}</SkipLink>
    <h1 className="text-2xl font-bold">{t("customerInvoice.confirmation")}</h1>
    <p className="font-mono">{formatMoney(payment.amountMinor, payment.currency, locale)}</p>
    <Callout tone={payment.status === "succeeded" ? "success" : "neutral"}>{t(pending ? "customerInvoice.pending" : payment.status === "succeeded" ? "customerInvoice.succeeded" : "customerInvoice.declined")}</Callout>
    {query.error ? <div role="alert"><Callout tone="danger">{t("customerInvoice.failed")}</Callout></div> : null}
    {pending ? <form action={confirmInvoicePaymentAction}><input type="hidden" name="token" value={token} /><PaymentButton label={t("customerInvoice.confirm")} pendingLabel={t("common.working")} /></form> : null}
    <a href={business ? localizeCustomerHref("/portal/invoices", locale, business) : "/portal/invoices"} className="text-accent underline">{t("customerInvoice.back")}</a>
    <a href={invoiceAppReturnHref()} className="text-accent underline">{t("app.invoice.return")}</a>
  </main>;
}
