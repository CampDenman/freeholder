// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Human payment operations over the exact services used by API and MCP.

import { randomUUID } from "node:crypto";
import { CreditCard, Warning } from "@phosphor-icons/react/dist/ssr";
import { minorToDecimal } from "@/adapters/payments/currency";
import { isHostedPaymentProvider } from "@/adapters/payments/providers";
import { hasModuleAccess } from "@/core/service";
import { listInvoices } from "@/modules/invoicing/invoice-service";
import {
  listPaymentDisputes,
  listPaymentProviders,
  listPayments,
  listSavedPaymentMethods,
  reconcilePaymentProviders,
} from "@/modules/invoicing/payment-provider-service";
import { Button, Callout, Card, CardBody, CardHeader, Field, Input, Pill, Select } from "@/ui/primitives";
import { getT } from "../../../i18n";
import { paymentAction } from "../../payment-actions";
import { requireStaffActor } from "../guard";

export const dynamic = "force-dynamic";

function money(amountMinor: number, currency: string): string {
  return `${currency} ${minorToDecimal(amountMinor, currency)}`;
}

export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; status?: string }>;
}) {
  const actor = await requireStaffActor("invoicing");
  const query = await searchParams;
  const errorCode = ["validation", "conflict", "not_found", "permission", "rate_limited"].includes(query.error ?? "")
    ? query.error!
    : "failed";
  const [providers, invoices, succeeded, methods, disputes, reconciliation, t] = await Promise.all([
    listPaymentProviders.call({ country: "US", currency: "USD", recurring: false }, actor),
    listInvoices.call({ limit: 300 }, actor),
    listPayments.call({ status: "succeeded", limit: 500 }, actor),
    listSavedPaymentMethods.call({ includeRevoked: false, limit: 500 }, actor),
    listPaymentDisputes.call({ limit: 200 }, actor),
    reconcilePaymentProviders.call({ limit: 200 }, actor),
    getT(),
  ]);
  const canManage = hasModuleAccess(actor, "invoicing", "manage");
  const stepUpValid = actor.kind === "user" && actor.security?.stepUpValid !== false;
  const openInvoices = invoices.filter((invoice) => ["sent", "viewed", "partially_paid", "overdue"].includes(invoice.status));
  const refundable = succeeded.filter(({ payment }) =>
    payment.refundedMinor < payment.amountMinor
    && (payment.provider === "manual" || payment.provider === "balance" || isHostedPaymentProvider(payment.provider)),
  );
  const attentionCount = reconciliation.unsettled.length + reconciliation.openDisputes.length + reconciliation.payouts.length;

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight">
          <CreditCard size={22} weight="duotone" className="text-accent" />
          {t("payments.title")}
        </h1>
        <p className="mt-1 max-w-prose text-sm text-ink-muted">{t("payments.intro")}</p>
      </div>

      {query.error ? <Callout tone="danger" icon={<Warning size={17} weight="fill" />}>{t(`payments.error.${errorCode}`)}</Callout> : null}
      {query.status ? <Callout tone="success">{t("payments.saved")}</Callout> : null}
      {canManage && !stepUpValid ? (
        <Callout tone="warning">
          {t("payments.stepUp")} <a className="font-semibold underline" href="/security/verify?returnTo=/admin/payments">{t("payments.verify")}</a>
        </Callout>
      ) : null}

      <Card>
        <CardHeader title={t("payments.providers")} />
        <CardBody>
          <ul className="grid list-none gap-3 p-0 sm:grid-cols-3">
            {providers.map((provider) => (
              <li key={provider.id} className="rounded-md border border-rule p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold capitalize">{provider.id}</span>
                  <Pill tone={provider.status.available ? "success" : "neutral"}>
                    {provider.selected ? t("payments.selected") : provider.status.available ? t("payments.ready") : t("payments.off")}
                  </Pill>
                </div>
                <p className="mt-2 text-xs text-ink-muted">{provider.status.message}</p>
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>

      {canManage ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader title={t("payments.record.title")} />
            <CardBody>
              {openInvoices.length === 0 ? <p className="text-sm text-ink-muted">{t("payments.record.empty")}</p> : (
                <form action={paymentAction} className="grid gap-4">
                  <input type="hidden" name="intent" value="record" />
                  <input type="hidden" name="idempotencyKey" value={`admin-offline-${randomUUID()}`} />
                  <Field label={t("payments.invoice")} htmlFor="offline-invoice">
                    <Select id="offline-invoice" name="invoiceId" required>
                      {openInvoices.map((invoice) => <option key={invoice.id} value={invoice.id}>{invoice.number} · {money(invoice.totalMinor - invoice.paidMinor, invoice.currency)}</option>)}
                    </Select>
                  </Field>
                  <Field label={t("payments.method")} htmlFor="offline-method">
                    <Select id="offline-method" name="method" required>
                      {["cash", "bank_transfer", "cheque", "external_card", "other"].map((method) => <option key={method} value={method}>{t(`payments.method.${method}`)}</option>)}
                    </Select>
                  </Field>
                  <Field label={t("payments.amount")} htmlFor="offline-amount" hint={t("payments.amountHint")}><Input id="offline-amount" name="amount" inputMode="decimal" required placeholder="100.00" /></Field>
                  <Field label={t("payments.reference")} htmlFor="offline-reference"><Input id="offline-reference" name="reference" maxLength={300} /></Field>
                  <Field label={t("payments.evidence")} htmlFor="offline-evidence"><Input id="offline-evidence" name="evidence" minLength={3} maxLength={1000} required /></Field>
                  <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="confirm" value="yes" required className="mt-1" />{t("payments.confirmRecord")}</label>
                  <Button type="submit">{t("payments.record.submit")}</Button>
                </form>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title={t("payments.refund.title")} />
            <CardBody>
              {refundable.length === 0 ? <p className="text-sm text-ink-muted">{t("payments.refund.empty")}</p> : (
                <form action={paymentAction} className="grid gap-4">
                  <input type="hidden" name="intent" value="refund" />
                  <input type="hidden" name="idempotencyKey" value={`admin-refund-${randomUUID()}`} />
                  <Field label={t("payments.payment")} htmlFor="refund-payment">
                    <Select id="refund-payment" name="paymentId" required>
                      {refundable.map(({ payment, invoiceNumber }) => <option key={payment.id} value={payment.id}>{invoiceNumber} · {payment.provider} · {money(payment.amountMinor - payment.refundedMinor, payment.currency)}</option>)}
                    </Select>
                  </Field>
                  <Field label={t("payments.amount")} htmlFor="refund-amount" hint={t("payments.amountHint")}><Input id="refund-amount" name="amount" inputMode="decimal" required placeholder="10.00" /></Field>
                  <Field label={t("payments.reason")} htmlFor="refund-reason"><Input id="refund-reason" name="reason" minLength={3} maxLength={1000} required /></Field>
                  <Field label={t("payments.reference")} htmlFor="refund-reference" hint={t("payments.refund.referenceHint")}><Input id="refund-reference" name="reference" maxLength={300} /></Field>
                  <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="confirm" value="yes" required className="mt-1" />{t("payments.confirmRefund")}</label>
                  <Button type="submit" variant="danger">{t("payments.refund.submit")}</Button>
                </form>
              )}
            </CardBody>
          </Card>
        </div>
      ) : null}

      <Card>
        <CardHeader title={t("payments.attention")} status={<Pill tone={attentionCount ? "warning" : "neutral"}>{attentionCount}</Pill>} />
        <CardBody>
          {attentionCount === 0 ? <p className="text-sm text-ink-muted">{t("payments.attention.empty")}</p> : (
            <div className="grid gap-4">
              {reconciliation.unsettled.map((payment) => (
                <div key={payment.id} className="flex flex-wrap items-center gap-2 border-b border-rule pb-3">
                  <Pill tone="warning">{payment.status}</Pill><span className="text-sm">{payment.provider} · {money(payment.amountMinor, payment.currency)}</span>
                  {canManage && payment.providerCheckoutRef ? <form action={paymentAction} className="ms-auto"><input type="hidden" name="intent" value="complete" /><input type="hidden" name="paymentId" value={payment.id} /><input type="hidden" name="idempotencyKey" value={`admin-complete-${payment.id}`} /><Button type="submit" variant="quiet">{t("payments.recheck")}</Button></form> : null}
                </div>
              ))}
              {reconciliation.openDisputes.map((dispute) => <div key={dispute.id} className="flex flex-wrap gap-2 text-sm"><Pill tone="danger">{t("payments.dispute")}</Pill><span>{dispute.provider} · {money(dispute.amountMinor, dispute.currency)}</span><span className="text-ink-muted">{dispute.reason ?? t("payments.noReason")}</span></div>)}
              {reconciliation.payouts.map((payout) => <div key={payout.id} className="flex flex-wrap gap-2 text-sm"><Pill tone={payout.status === "failed" ? "danger" : "warning"}>{t("payments.payout")}</Pill><span>{payout.provider} · {money(payout.amountMinor, payout.currency)}</span><span className="text-ink-muted">{payout.status.replaceAll("_", " ")}</span></div>)}
            </div>
          )}
          {reconciliation.balanceTransactions.length ? <p className="mt-4 text-xs text-ink-muted">{t("payments.unmatchedBalance", { count: reconciliation.balanceTransactions.length })}</p> : null}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("payments.methods.title")} status={<Pill tone="neutral">{methods.length}</Pill>} />
        <CardBody>
          {methods.length === 0 ? <p className="text-sm text-ink-muted">{t("payments.methods.empty")}</p> : (
            <ul className="grid list-none gap-3 p-0">
              {methods.map((method) => <li key={method.id} className="flex flex-wrap items-center gap-2 border-b border-rule pb-3 last:border-0"><span className="text-sm font-medium">{method.label}</span><Pill tone="neutral">{method.provider}</Pill>{canManage ? <form action={paymentAction} className="ms-auto flex items-center gap-2"><input type="hidden" name="intent" value="revoke" /><input type="hidden" name="methodId" value={method.id} /><input type="hidden" name="idempotencyKey" value={`admin-revoke-${method.id}`} /><label className="text-xs"><input type="checkbox" name="confirm" value="yes" required /> {t("payments.confirmRevoke")}</label><Button type="submit" variant="danger">{t("payments.revoke")}</Button></form> : null}</li>)}
            </ul>
          )}
        </CardBody>
      </Card>

      <p className="text-xs text-ink-muted">{t("payments.disputeCount", { count: disputes.length })}</p>
    </div>
  );
}
