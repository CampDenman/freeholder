// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Invoice list over the same services exposed to HTTP and MCP.

import { Plus, Receipt, Scales } from "@phosphor-icons/react/dist/ssr";
import { getContact, listContacts } from "@/core/contacts/service";
import { hasModuleAccess } from "@/core/service";
import { listInvoices, reconcileMoney } from "@/modules/invoicing/invoice-service";
import { Card, CardBody, CardHeader, Pill, Select } from "@/ui/primitives";
import { getT } from "../../../i18n";
import { requireStaffActor } from "../guard";
import { INVOICE_STATUSES, invoiceTone, money } from "./format";

export const dynamic = "force-dynamic";

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const actor = await requireStaffActor("invoicing");
  const query = await searchParams;
  const status = INVOICE_STATUSES.includes(query.status as (typeof INVOICE_STATUSES)[number])
    ? (query.status as (typeof INVOICE_STATUSES)[number])
    : undefined;
  const [rows, reconciliation, contacts, t] = await Promise.all([
    listInvoices.call({ ...(status ? { status } : {}), limit: 300 }, actor),
    reconcileMoney.call({ limit: 1_000 }, actor),
    listContacts.call({ limit: 100 }, actor).catch(() => ({ rows: [], total: 0 })),
    getT(),
  ]);
  const names = new Map(contacts.rows.map((contact) => [contact.id, contact.name]));
  const missing = [...new Set(rows.map((invoice) => invoice.contactId).filter((id) => !names.has(id)))];
  await Promise.all(
    missing.map(async (id) => {
      const contact = await getContact.call({ id }, actor).catch(() => null);
      if (contact) names.set(contact.id, contact.name);
    }),
  );
  const canManage = hasModuleAccess(actor, "invoicing", "manage");

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-start gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight">
            <Receipt size={22} weight="duotone" className="text-accent" />
            {t("invoices.title")}
          </h1>
          <p className="mt-1 max-w-prose text-sm text-ink-muted">{t("invoices.intro")}</p>
        </div>
        <div className="ms-auto flex flex-wrap gap-2">
          <a
            href="/admin/invoices/tax"
            className="inline-flex items-center gap-2 rounded-md border border-rule px-4 py-2 text-sm font-semibold"
          >
            <Scales size={16} weight="bold" />
            {t("invoices.tax")}
          </a>
          {canManage ? (
            <a
              href="/admin/invoices/new"
              className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-on-accent"
            >
              <Plus size={16} weight="bold" />
              {t("invoices.add")}
            </a>
          ) : null}
        </div>
      </div>

      <form className="grid gap-3 rounded-lg border border-rule bg-surface p-4 sm:grid-cols-[1fr_auto]">
        <Select name="status" defaultValue={status ?? ""} aria-label={t("invoices.filter.status")}>
          <option value="">{t("invoices.filter.allStatuses")}</option>
          {INVOICE_STATUSES.map((value) => (
            <option key={value} value={value}>{t(`invoices.status.${value}`)}</option>
          ))}
        </Select>
        <button className="rounded-md border border-rule px-4 py-2 text-sm font-semibold" type="submit">
          {t("invoices.filter.apply")}
        </button>
      </form>

      <Card>
        <CardHeader
          title={t("invoices.reconciliation")}
          status={
            <Pill tone={reconciliation.balanced ? "success" : "danger"}>
              {reconciliation.balanced ? t("invoices.reconciliation.ok") : t("invoices.reconciliation.problem")}
            </Pill>
          }
        />
        <CardBody>
          {reconciliation.balanced ? (
            <p className="text-sm text-ink-muted">{t("invoices.reconciliation.empty")}</p>
          ) : (
            <ul className="grid list-none gap-2 p-0 text-sm">
              {reconciliation.discrepancies.map((row) => (
                <li key={`${row.subjectType}-${row.subjectId}-${row.field}`}>
                  {row.subjectType} {row.field}: {row.recordedMinor} ≠ {row.calculatedMinor}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      {rows.length === 0 ? (
        <Card><CardBody><p className="text-sm text-ink-muted">{t("invoices.empty")}</p></CardBody></Card>
      ) : (
        <ul className="grid list-none gap-3 p-0">
          {rows.map((invoice) => (
            <li key={invoice.id}>
              <a
                href={`/admin/invoices/${invoice.id}`}
                className="flex flex-wrap items-center gap-3 rounded-lg border border-rule bg-surface px-4 py-4 hover:border-accent"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-ink">
                    {invoice.number ?? t("invoices.draftNumber")}
                  </p>
                  <p className="mt-1 text-xs text-ink-muted">
                    {names.get(invoice.contactId) ?? invoice.contactId}
                  </p>
                </div>
                <Pill tone={invoiceTone(invoice.status)}>{t(`invoices.status.${invoice.status}`)}</Pill>
                <span className="font-mono text-sm">{money(invoice.totalMinor, invoice.currency)}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
