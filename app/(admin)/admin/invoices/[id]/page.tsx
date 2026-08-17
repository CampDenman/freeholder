// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Invoice detail, issue/void, tax evidence, credits, and receipts.

import { randomUUID } from "node:crypto";
import { notFound } from "next/navigation";
import { WarningCircle } from "@phosphor-icons/react/dist/ssr";
import { getContact } from "@/core/contacts/service";
import { formatDateTime } from "@/core/i18n";
import { currentBusiness } from "@/core/settings/read";
import { hasModuleAccess, ServiceError } from "@/core/service";
import {
  getInvoice,
  getPaymentReceipt,
} from "@/modules/invoicing/invoice-service";
import { Button, Callout, Card, CardBody, CardHeader, Field, Input, Pill } from "@/ui/primitives";
import { getT } from "../../../../i18n";
import { invoiceAction } from "../../../invoice-actions";
import { requireStaffActor } from "../../guard";
import { formatPpm, invoiceTone, money, quantityFromMicros } from "../format";

export const dynamic = "force-dynamic";

export default async function InvoiceDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const actor = await requireStaffActor("invoicing");
  const { id } = await params;
  const query = await searchParams;
  const bundle = await getInvoice.call({ id }, actor).catch((error: unknown) => {
    if (error instanceof ServiceError && error.code === "not_found") notFound();
    throw error;
  });
  const [contact, business, t] = await Promise.all([
    getContact.call({ id: bundle.invoice.contactId }, actor).catch(() => null),
    currentBusiness(),
    getT(),
  ]);
  const canManage = hasModuleAccess(actor, "invoicing", "manage");
  const stepUpValid = actor.kind === "user" && actor.security?.stepUpValid !== false;
  const timezone = business?.timezone ?? "UTC";
  const locale = business?.defaultLocale ?? "en";
  const invoice = bundle.invoice;
  const errorCode = ["validation", "conflict", "not_found", "permission", "rate_limited"].includes(query.error ?? "")
    ? query.error!
    : query.error
      ? "failed"
      : null;
  const receipts = (
    await Promise.all(
      bundle.payments
        .filter((payment) => payment.status === "succeeded")
        .map((payment) => getPaymentReceipt.call({ paymentId: payment.id }, actor).catch(() => null)),
    )
  ).filter((row) => row !== null);

  return (
    <div className="grid gap-6">
      <div>
        <a href="/admin/invoices" className="text-sm text-ink-muted">{t("invoices.back")}</a>
        <h1 className="mt-2 flex flex-wrap items-center gap-3 text-xl font-bold tracking-tight">
          {invoice.number ?? t("invoices.draftNumber")}
          <Pill tone={invoiceTone(invoice.status)}>{t(`invoices.status.${invoice.status}`)}</Pill>
        </h1>
        <p className="mt-1 text-sm text-ink-muted">
          {contact ? (
            <a href={`/admin/contacts/${contact.id}`} className="font-semibold text-ink hover:text-accent">
              {contact.name}
            </a>
          ) : invoice.contactId}{" "}
          · {money(invoice.totalMinor, invoice.currency)}
        </p>
      </div>

      {errorCode ? (
        <Callout tone="danger" icon={<WarningCircle size={17} weight="fill" />}>
          {t(`invoices.error.${errorCode}`)}
        </Callout>
      ) : null}
      {query.saved ? <Callout tone="success">{t(`invoices.saved.${query.saved}`)}</Callout> : null}
      {canManage && !stepUpValid ? (
        <Callout tone="warning">
          {t("invoices.stepUp")}{" "}
          <a className="font-semibold underline" href={`/security/verify?returnTo=/admin/invoices/${invoice.id}`}>
            {t("invoices.verify")}
          </a>
        </Callout>
      ) : null}

      <Card>
        <CardHeader title={t("invoices.totals")} />
        <CardBody>
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <div className="flex justify-between gap-4"><dt className="text-ink-muted">{t("invoices.subtotal")}</dt><dd className="font-mono">{money(invoice.subtotalMinor, invoice.currency)}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-ink-muted">{t("invoices.discount")}</dt><dd className="font-mono">{money(invoice.discountMinor, invoice.currency)}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-ink-muted">{t("invoices.shippingAmount")}</dt><dd className="font-mono">{money(invoice.shippingMinor, invoice.currency)}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-ink-muted">{t("invoices.taxAmount")}</dt><dd className="font-mono">{money(invoice.taxMinor, invoice.currency)}</dd></div>
            <div className="flex justify-between gap-4 font-semibold"><dt>{t("invoices.total")}</dt><dd className="font-mono">{money(invoice.totalMinor, invoice.currency)}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-ink-muted">{t("invoices.paid")}</dt><dd className="font-mono">{money(invoice.paidMinor, invoice.currency)}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-ink-muted">{t("invoices.refunded")}</dt><dd className="font-mono">{money(invoice.refundedMinor, invoice.currency)}</dd></div>
            {invoice.issuedAt ? (
              <div className="flex justify-between gap-4">
                <dt className="text-ink-muted">{t("invoices.issued")}</dt>
                <dd>{formatDateTime(invoice.issuedAt, timezone, locale)}</dd>
              </div>
            ) : null}
            {invoice.dueAt ? (
              <div className="flex justify-between gap-4">
                <dt className="text-ink-muted">{t("invoices.dueAt")}</dt>
                <dd>{formatDateTime(invoice.dueAt, timezone, locale)}</dd>
              </div>
            ) : null}
          </dl>
          {invoice.requiredTaxLegend ? <p className="mt-4 text-sm">{invoice.requiredTaxLegend}</p> : null}
          {invoice.memo ? <p className="mt-3 text-sm text-ink-muted">{invoice.memo}</p> : null}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("invoices.lines.title")} />
        <CardBody>
          <ul className="grid list-none gap-3 p-0">
            {bundle.lines.map((line) => (
              <li key={line.id} className="border-b border-rule pb-3 last:border-0">
                <p className="font-medium">{line.description}</p>
                <p className="mt-1 font-mono text-xs text-ink-muted">
                  {quantityFromMicros(line.quantityMicros)} × {money(line.unitAmountMinor, invoice.currency)} = {money(line.totalMinor, invoice.currency)}
                </p>
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("invoices.taxLines")} />
        <CardBody>
          {bundle.taxLines.length === 0 ? (
            <p className="text-sm text-ink-muted">{t("invoices.taxLines.empty")}</p>
          ) : (
            <ul className="grid list-none gap-3 p-0">
              {bundle.taxLines.map((line) => (
                <li key={line.id} className="border-b border-rule pb-3 text-sm last:border-0">
                  <p className="font-medium">{line.rateName} · {formatPpm(line.ratePpm)} · {money(line.amountMinor, invoice.currency)}</p>
                  <p className="mt-1 text-ink-muted">{line.jurisdiction}{line.registrationNumber ? ` · ${line.registrationNumber}` : ""}</p>
                  {line.explanation ? <p className="mt-1 text-xs text-ink-muted">{line.explanation}</p> : null}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      {canManage && invoice.status === "draft" ? (
        <Card>
          <CardHeader title={t("invoices.issue")} />
          <CardBody>
            <form action={invoiceAction} className="grid gap-4 sm:grid-cols-[1fr_auto]">
              <input type="hidden" name="intent" value="issue" />
              <input type="hidden" name="id" value={invoice.id} />
              <Field label={t("invoices.dueAt")} htmlFor="issue-due">
                <Input id="issue-due" name="dueAt" type="date" />
              </Field>
              <div className="self-end"><Button type="submit">{t("invoices.issue")}</Button></div>
            </form>
            <p className="mt-3 text-xs text-ink-muted">{t("invoices.issueHint")}</p>
          </CardBody>
        </Card>
      ) : null}

      {canManage && ["draft", "sent", "viewed", "overdue", "partially_paid"].includes(invoice.status) && invoice.paidMinor === 0 ? (
        <Card>
          <CardHeader title={t("invoices.void")} />
          <CardBody>
            <form action={invoiceAction} className="grid gap-4">
              <input type="hidden" name="intent" value="void" />
              <input type="hidden" name="id" value={invoice.id} />
              <Field label={t("invoices.voidReason")} htmlFor="void-reason">
                <Input id="void-reason" name="reason" minLength={3} maxLength={1000} required />
              </Field>
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" name="confirm" value="yes" required className="mt-1" />
                {t("invoices.confirmVoid")}
              </label>
              <div><Button type="submit" variant="danger">{t("invoices.void")}</Button></div>
            </form>
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardHeader title={t("invoices.payments")} />
        <CardBody>
          {bundle.payments.length === 0 ? (
            <p className="text-sm text-ink-muted">{t("invoices.payments.empty")}</p>
          ) : (
            <ul className="grid list-none gap-2 p-0 text-sm">
              {bundle.payments.map((payment) => (
                <li key={payment.id} className="flex flex-wrap gap-2">
                  <Pill>{payment.status}</Pill>
                  <span>{payment.provider} · {money(payment.amountMinor, payment.currency)}</span>
                </li>
              ))}
            </ul>
          )}
          {invoice.status !== "draft" && invoice.status !== "void" && invoice.totalMinor > invoice.paidMinor ? (
            <p className="mt-3 text-sm">
              <a href="/admin/payments" className="font-semibold text-accent">{t("invoices.recordPayment")}</a>
            </p>
          ) : null}
        </CardBody>
      </Card>

      {receipts.length > 0 ? (
        <Card>
          <CardHeader title={t("invoices.receipt")} />
          <CardBody>
            <ul className="grid list-none gap-3 p-0 text-sm">
              {receipts.map((receipt) => (
                <li key={receipt.receiptNumber} className="rounded-md border border-rule p-3">
                  <p className="font-semibold">{receipt.receiptNumber}</p>
                  <p className="mt-1 text-ink-muted">
                    {receipt.payment.provider} · {money(receipt.payment.amountMinor, receipt.invoice.currency)}
                    {receipt.issuedAt ? ` · ${formatDateTime(receipt.issuedAt, timezone, locale)}` : ""}
                  </p>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardHeader title={t("invoices.credits")} />
        <CardBody>
          {bundle.creditNotes.length === 0 ? (
            <p className="text-sm text-ink-muted">{t("invoices.credits.empty")}</p>
          ) : (
            <ul className="grid list-none gap-3 p-0">
              {bundle.creditNotes.map((note) => (
                <li key={note.id} className="grid gap-3 border-b border-rule pb-3 last:border-0">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-semibold">{note.number ?? t("invoices.draftNumber")}</span>
                    <Pill>{note.status}</Pill>
                    <span className="font-mono">{money(note.totalMinor, note.currency)}</span>
                  </div>
                  <p className="text-xs text-ink-muted">{note.reason}</p>
                  {canManage && note.status === "draft" ? (
                    <form action={invoiceAction}>
                      <input type="hidden" name="intent" value="issueCredit" />
                      <input type="hidden" name="id" value={invoice.id} />
                      <input type="hidden" name="creditId" value={note.id} />
                      <Button type="submit">{t("invoices.credit.issue")}</Button>
                    </form>
                  ) : null}
                  {canManage && note.status === "issued" ? (
                    <form action={invoiceAction} className="grid gap-3">
                      <input type="hidden" name="intent" value="voidCredit" />
                      <input type="hidden" name="id" value={invoice.id} />
                      <input type="hidden" name="creditId" value={note.id} />
                      <Field label={t("invoices.voidReason")} htmlFor={`void-credit-${note.id}`}>
                        <Input id={`void-credit-${note.id}`} name="reason" minLength={3} required />
                      </Field>
                      <label className="flex items-start gap-2 text-sm">
                        <input type="checkbox" name="confirm" value="yes" required className="mt-1" />
                        {t("invoices.credit.confirm")}
                      </label>
                      <div><Button type="submit" variant="danger">{t("invoices.credit.void")}</Button></div>
                    </form>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {canManage && invoice.status !== "draft" && invoice.status !== "void" ? (
            <form action={invoiceAction} className="mt-4 grid gap-4 rounded-md border border-rule p-4">
              <input type="hidden" name="intent" value="credit" />
              <input type="hidden" name="id" value={invoice.id} />
              <input type="hidden" name="currency" value={invoice.currency} />
              <input type="hidden" name="idempotencyKey" value={`admin-credit-${randomUUID()}`} />
              <Field label={t("invoices.credit.reason")} htmlFor="credit-reason">
                <Input id="credit-reason" name="reason" minLength={3} maxLength={1000} required />
              </Field>
              <Field label={t("invoices.description")} htmlFor="credit-description">
                <Input id="credit-description" name="description" required maxLength={1000} />
              </Field>
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label={t("invoices.quantity")} htmlFor="credit-quantity">
                  <Input id="credit-quantity" name="quantity" defaultValue="1" />
                </Field>
                <Field label={t("invoices.subtotal")} htmlFor="credit-subtotal">
                  <Input id="credit-subtotal" name="subtotal" inputMode="decimal" required />
                </Field>
                <Field label={t("invoices.taxAmount")} htmlFor="credit-tax">
                  <Input id="credit-tax" name="tax" inputMode="decimal" />
                </Field>
              </div>
              <div><Button type="submit">{t("invoices.credit.create")}</Button></div>
            </form>
          ) : null}
        </CardBody>
      </Card>
    </div>
  );
}
