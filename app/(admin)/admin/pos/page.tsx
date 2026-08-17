// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// In-person collection at a location (C5.24).

import { randomUUID } from "node:crypto";
import { DeviceMobile, WarningCircle } from "@phosphor-icons/react/dist/ssr";
import { listLocations } from "@/core/locations/service";
import { hasModuleAccess } from "@/core/service";
import { listInvoices } from "@/modules/invoicing/invoice-service";
import {
  listInPersonPayments,
  listPointOfSale,
  reconcileInPersonPayments,
} from "@/modules/invoicing/pos-service";
import { Button, Callout, Card, CardBody, CardHeader, Field, Input, Pill, Select } from "@/ui/primitives";
import { getT } from "../../../i18n";
import { paymentAction } from "../../payment-actions";
import { requireStaffActor } from "../guard";
import { money } from "../invoices/format";

export const dynamic = "force-dynamic";

export default async function PointOfSalePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; status?: string }>;
}) {
  const actor = await requireStaffActor("invoicing");
  const query = await searchParams;
  const [adapters, invoices, takes, reconciliation, locations, t] = await Promise.all([
    listPointOfSale.call({}, actor),
    listInvoices.call({ limit: 200 }, actor),
    listInPersonPayments.call({ limit: 100 }, actor),
    reconcileInPersonPayments.call({}, actor),
    listLocations.call({ includeHidden: true }, actor),
    getT(),
  ]);
  const canManage = hasModuleAccess(actor, "invoicing", "manage");
  const open = invoices.filter((invoice) =>
    ["sent", "viewed", "partially_paid", "overdue"].includes(invoice.status),
  );
  const stripe = adapters.find((row) => row.id === "stripe");

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight">
          <DeviceMobile size={22} weight="duotone" className="text-accent" />
          {t("pos.title")}
        </h1>
        <p className="mt-1 max-w-prose text-sm text-ink-muted">{t("pos.intro")}</p>
      </div>
      {query.error ? (
        <Callout tone="danger" icon={<WarningCircle size={17} weight="fill" />}>
          {t(`pos.error.${["validation", "conflict", "not_found", "permission", "rate_limited"].includes(query.error) ? query.error : "failed"}`)}
        </Callout>
      ) : null}
      {query.status ? <Callout tone="success">{t("pos.saved")}</Callout> : null}

      <Card>
        <CardHeader title={t("pos.adapters")} />
        <CardBody>
          <ul className="grid list-none gap-3 p-0 sm:grid-cols-2">
            {adapters.map((adapter) => (
              <li key={adapter.id} className="rounded-md border border-rule p-3 text-sm">
                <p className="font-semibold">{t(`pos.adapter.${adapter.id}`)}</p>
                <p className="mt-1 text-ink-muted">{adapter.status.message}</p>
                <p className="mt-2 text-xs">
                  {adapter.capabilities.cashRecording ? t("pos.cap.cash") : null}
                  {adapter.capabilities.countertop ? ` · ${t("pos.cap.countertop")}` : null}
                  {adapter.capabilities.tapToPay ? ` · ${t("pos.cap.tap")}` : null}
                </p>
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>

      {canManage && open.length && locations.length ? (
        <Card>
          <CardHeader title={t("pos.collect")} />
          <CardBody>
            <form action={paymentAction} className="grid gap-3 sm:grid-cols-2">
              <input type="hidden" name="intent" value="inPerson" />
              <input type="hidden" name="confirm" value="yes" />
              <input type="hidden" name="idempotencyKey" value={randomUUID()} />
              <input type="hidden" name="returnTo" value="/admin/pos" />
              <Field label={t("pos.invoice")} htmlFor="pos-invoice">
                <Select id="pos-invoice" name="invoiceId" required>
                  {open.map((invoice) => (
                    <option key={invoice.id} value={invoice.id}>
                      {invoice.number ?? invoice.id.slice(0, 8)} · {money(invoice.totalMinor - invoice.paidMinor, invoice.currency)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t("pos.location")} htmlFor="pos-loc">
                <Select id="pos-loc" name="locationId" required>
                  {locations.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
                </Select>
              </Field>
              <Field label={t("pos.method")} htmlFor="pos-method">
                <Select id="pos-method" name="method" required>
                  <option value="cash">{t("pos.method.cash")}</option>
                  {stripe?.capabilities.countertop ? <option value="card_present">{t("pos.method.card_present")}</option> : null}
                  {stripe?.capabilities.tapToPay ? <option value="tap_to_pay">{t("pos.method.tap_to_pay")}</option> : null}
                </Select>
              </Field>
              <Field label={t("pos.amount")} htmlFor="pos-amount">
                <Input id="pos-amount" name="amount" inputMode="decimal" required />
              </Field>
              {stripe?.status.available ? (
                <Field label={t("pos.reader")} htmlFor="pos-reader">
                  <Input id="pos-reader" name="readerRef" />
                </Field>
              ) : null}
              <div><Button type="submit">{t("pos.take")}</Button></div>
            </form>
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardHeader title={t("pos.reconcile")} />
        <CardBody>
          <p className="mb-3 text-sm">
            {reconciliation.balanced ? t("pos.reconcile.ok") : t("pos.reconcile.open", { count: reconciliation.unsettled.length })}
          </p>
          {takes.length === 0 ? (
            <p className="text-sm text-ink-muted">{t("pos.empty")}</p>
          ) : (
            <ul className="grid list-none gap-2 p-0 text-sm">
              {takes.map((row) => (
                <li key={row.id} className="flex flex-wrap items-center gap-2">
                  <Pill>{t(`pos.method.${row.method}`)}</Pill>
                  <span className="font-mono">{money(row.amountMinor, row.currency)}</span>
                  <span>{row.status}</span>
                  {row.status === "succeeded" ? (
                    <a href={`/admin/invoices/${row.invoiceId}`} className="ms-auto font-semibold text-accent">
                      {t("pos.receipt")}
                    </a>
                  ) : (
                    <span className="ms-auto text-ink-muted">{t("pos.waiting")}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
