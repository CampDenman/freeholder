// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Manual draft invoice form. Tax and totals are calculated by invoicing services.

import { randomUUID } from "node:crypto";
import { WarningCircle } from "@phosphor-icons/react/dist/ssr";
import { listContacts } from "@/core/contacts/service";
import { currentBusiness } from "@/core/settings/read";
import { listTaxConfiguration } from "@/modules/invoicing/tax-service";
import { Button, Callout, Card, CardBody, CardHeader, Field, Input, Select } from "@/ui/primitives";
import { getT } from "../../../../i18n";
import { invoiceAction } from "../../../invoice-actions";
import { requireStaffActor } from "../../guard";

export const dynamic = "force-dynamic";

export default async function NewInvoicePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; contactId?: string }>;
}) {
  const actor = await requireStaffActor("invoicing", "manage");
  const query = await searchParams;
  const [contacts, tax, business, t] = await Promise.all([
    listContacts.call({ limit: 100 }, actor),
    listTaxConfiguration.call({}, actor),
    currentBusiness(),
    getT(),
  ]);
  const errorCode = ["validation", "conflict", "not_found", "permission", "rate_limited"].includes(query.error ?? "")
    ? query.error!
    : query.error
      ? "failed"
      : null;
  const selected = query.contactId && contacts.rows.some((row) => row.id === query.contactId)
    ? query.contactId
    : "";

  return (
    <div className="grid gap-6">
      <div>
        <a href="/admin/invoices" className="text-sm text-ink-muted">{t("invoices.back")}</a>
        <h1 className="mt-2 text-xl font-bold tracking-tight">{t("invoices.new.title")}</h1>
        <p className="mt-1 max-w-prose text-sm text-ink-muted">{t("invoices.new.intro")}</p>
      </div>
      {errorCode ? (
        <Callout tone="danger" icon={<WarningCircle size={17} weight="fill" />}>
          {t(`invoices.error.${errorCode}`)}
        </Callout>
      ) : null}
      {contacts.rows.length === 0 ? (
        <Card>
          <CardBody>
            <p className="text-sm text-ink-muted">{t("invoices.new.noContacts")}</p>
            <a href="/admin/contacts/new" className="mt-3 inline-block text-sm font-semibold text-accent">
              {t("invoices.new.addContact")}
            </a>
          </CardBody>
        </Card>
      ) : (
        <Card>
          <CardHeader title={t("invoices.new.details")} />
          <CardBody>
            <form action={invoiceAction} className="grid gap-5">
              <input type="hidden" name="intent" value="create" />
              <input type="hidden" name="idempotencyKey" value={`admin-invoice-${randomUUID()}`} />
              <div className="grid gap-5 sm:grid-cols-2">
                <Field label={t("invoices.contact")} htmlFor="contactId">
                  <Select id="contactId" name="contactId" required defaultValue={selected}>
                    <option value="">{t("invoices.contactChoose")}</option>
                    {contacts.rows.map((contact) => (
                      <option key={contact.id} value={contact.id}>
                        {contact.name}{contact.email ? ` · ${contact.email}` : ""}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={t("invoices.currency")} htmlFor="currency" hint={t("invoices.currencyHint")}>
                  <Input id="currency" name="currency" required defaultValue={business?.baseCurrency ?? "USD"} maxLength={3} className="font-mono uppercase" />
                </Field>
              </div>

              <fieldset className="grid gap-4">
                <legend className="text-sm font-semibold">{t("invoices.lines")}</legend>
                {[0, 1, 2, 3, 4].map((index) => (
                  <div key={index} className="grid gap-3 rounded-md border border-rule p-3 sm:grid-cols-4">
                    <Field label={t("invoices.lineDescription", { n: index + 1 })} htmlFor={`description-${index}`}>
                      <Input id={`description-${index}`} name={`description-${index}`} maxLength={1000} required={index === 0} />
                    </Field>
                    <Field label={t("invoices.lineQuantity", { n: index + 1 })} htmlFor={`quantity-${index}`} hint={index === 0 ? t("invoices.quantityHint") : undefined}>
                      <Input id={`quantity-${index}`} name={`quantity-${index}`} inputMode="decimal" defaultValue="1" />
                    </Field>
                    <Field label={t("invoices.lineAmount", { n: index + 1 })} htmlFor={`amount-${index}`}>
                      <Input id={`amount-${index}`} name={`amount-${index}`} inputMode="decimal" placeholder="100.00" required={index === 0} />
                    </Field>
                    <Field label={t("invoices.lineTaxCategory", { n: index + 1 })} htmlFor={`taxCategory-${index}`}>
                      <Select id={`taxCategory-${index}`} name={`taxCategory-${index}`} defaultValue="standard">
                        <option value="standard">{t("invoices.taxCategoryStandard")}</option>
                        {tax.categories.map((category) => (
                          <option key={category.id} value={category.code}>{category.name} ({category.code})</option>
                        ))}
                      </Select>
                    </Field>
                  </div>
                ))}
              </fieldset>

              <div className="grid gap-5 sm:grid-cols-2">
                <Field label={t("invoices.shipping")} htmlFor="shipping">
                  <Input id="shipping" name="shipping" inputMode="decimal" placeholder="0.00" />
                </Field>
                <Field label={t("invoices.dueAt")} htmlFor="dueAt">
                  <Input id="dueAt" name="dueAt" type="date" />
                </Field>
              </div>
              <Field label={t("invoices.memo")} htmlFor="memo">
                <Input id="memo" name="memo" maxLength={4000} />
              </Field>

              <fieldset className="grid gap-4">
                <legend className="text-sm font-semibold">{t("invoices.taxMode")}</legend>
                <label className="flex items-start gap-2 text-sm">
                  <input type="radio" name="taxMode" value="not_applicable" defaultChecked className="mt-1" />
                  {t("invoices.taxMode.not_applicable")}
                </label>
                <Field label={t("invoices.taxReason")} htmlFor="taxReason">
                  <Input id="taxReason" name="taxReason" maxLength={1000} defaultValue={t("invoices.taxReasonDefault")} />
                </Field>
                <label className="flex items-start gap-2 text-sm">
                  <input type="radio" name="taxMode" value="calculate" className="mt-1" />
                  {t("invoices.taxMode.calculate")}
                </label>
                <div className="grid gap-4 sm:grid-cols-3">
                  <Field label={t("invoices.originCountry")} htmlFor="originCountry">
                    <Input id="originCountry" name="originCountry" maxLength={2} defaultValue={business?.country ?? ""} className="font-mono uppercase" />
                  </Field>
                  <Field label={t("invoices.originRegion")} htmlFor="originRegion">
                    <Input id="originRegion" name="originRegion" maxLength={100} className="font-mono uppercase" />
                  </Field>
                  <Field label={t("invoices.originPostal")} htmlFor="originPostal">
                    <Input id="originPostal" name="originPostal" maxLength={30} className="font-mono uppercase" />
                  </Field>
                  <Field label={t("invoices.destinationCountry")} htmlFor="destinationCountry">
                    <Input id="destinationCountry" name="destinationCountry" maxLength={2} defaultValue={business?.country ?? ""} className="font-mono uppercase" />
                  </Field>
                  <Field label={t("invoices.destinationRegion")} htmlFor="destinationRegion">
                    <Input id="destinationRegion" name="destinationRegion" maxLength={100} className="font-mono uppercase" />
                  </Field>
                  <Field label={t("invoices.destinationPostal")} htmlFor="destinationPostal">
                    <Input id="destinationPostal" name="destinationPostal" maxLength={30} className="font-mono uppercase" />
                  </Field>
                </div>
              </fieldset>
              <div><Button type="submit">{t("invoices.create")}</Button></div>
            </form>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
