// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { localizeCustomerHref } from "@/core/i18n/customer";
import { currentBusiness } from "@/core/settings/read";
import { ServiceError } from "@/core/service";
import { getCustomerInvoice, viewCustomerInvoice } from "@/modules/invoicing/customer-service";
import { getLocale, getT } from "../../../i18n";
import { InvoiceView } from "../InvoiceView";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("invoices.title"), robots: { index: false, follow: false }, referrer: "no-referrer" };
}

export default async function CustomerInvoicePage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ token?: string; checkout?: string; error?: string }>;
}) {
  const [{ id }, query, jar, business, locale, t] = await Promise.all([params, searchParams, cookies(), currentBusiness(), getLocale(), getT()]);
  const actor = await actorFromToken(jar.get(SESSION_COOKIE)?.value);
  if (!query.token && actor.kind === "anonymous") redirect(business ? localizeCustomerHref("/portal/login", locale, business) : "/portal/login");
  const input = { id, token: query.token };
  const invoice = await getCustomerInvoice.call(input, actor).catch((error: unknown) => {
    if (error instanceof ServiceError && ["not_found", "permission", "validation"].includes(error.code)) notFound();
    throw error;
  });
  if (invoice.canPay) await viewCustomerInvoice.call(input, actor);
  return <InvoiceView invoice={invoice} token={query.token} t={t} locale={locale} timezone={business?.timezone ?? "UTC"}
    businessName={business?.name ?? ""} checkout={query.checkout} error={query.error}
    backHref={business ? localizeCustomerHref("/portal/invoices", locale, business) : "/portal/invoices"} />;
}
