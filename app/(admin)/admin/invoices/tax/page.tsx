// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Tax studio over the existing template, zone, rate, registration and exemption services.

import { Scales, WarningCircle } from "@phosphor-icons/react/dist/ssr";
import { listContacts } from "@/core/contacts/service";
import { currentBusiness } from "@/core/settings/read";
import { hasModuleAccess } from "@/core/service";
import {
  listTaxConfiguration,
  listTaxTemplates,
  listTaxThresholds,
} from "@/modules/invoicing/tax-service";
import { Button, Callout, Card, CardBody, CardHeader, Field, Input, Pill, Select } from "@/ui/primitives";
import { getT } from "../../../../i18n";
import { taxAction } from "../../../invoice-actions";
import { requireStaffActor } from "../../guard";
import { formatPpm, money } from "../format";

export const dynamic = "force-dynamic";

const GROUPS = [
  "canada",
  "european_union",
  "united_kingdom",
  "united_states",
  "australia",
  "new_zealand",
] as const;

export default async function TaxStudioPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; saved?: string; group?: string }>;
}) {
  const actor = await requireStaffActor("invoicing");
  const query = await searchParams;
  const group = GROUPS.includes(query.group as (typeof GROUPS)[number])
    ? (query.group as (typeof GROUPS)[number])
    : undefined;
  const [templates, configuration, thresholds, contacts, business, t] = await Promise.all([
    listTaxTemplates.call(group ? { group } : {}, actor),
    listTaxConfiguration.call({}, actor),
    listTaxThresholds.call({}, actor),
    listContacts.call({ limit: 100 }, actor).catch(() => ({ rows: [], total: 0 })),
    currentBusiness(),
    getT(),
  ]);
  const canManage = hasModuleAccess(actor, "invoicing", "manage");
  const errorCode = ["validation", "conflict", "not_found", "permission", "rate_limited"].includes(query.error ?? "")
    ? query.error!
    : query.error
      ? "failed"
      : null;
  const grouped = GROUPS.map((key) => ({
    key,
    templates: templates.templates.filter((template) => template.group === key),
  })).filter((entry) => entry.templates.length > 0);
  const zoneName = new Map(configuration.zones.map((zone) => [zone.id, zone.name]));
  const installed = new Set(
    configuration.zones.map((zone) => zone.templateKey).filter((key): key is string => Boolean(key)),
  );

  return (
    <div className="grid gap-6">
      <div>
        <a href="/admin/invoices" className="text-sm text-ink-muted">{t("invoices.back")}</a>
        <h1 className="mt-2 flex items-center gap-2 text-xl font-bold tracking-tight">
          <Scales size={22} weight="duotone" className="text-accent" />
          {t("tax.title")}
        </h1>
        <p className="mt-1 max-w-prose text-sm text-ink-muted">{t("tax.intro")}</p>
      </div>
      {errorCode ? (
        <Callout tone="danger" icon={<WarningCircle size={17} weight="fill" />}>
          {t(`tax.error.${errorCode}`)}
        </Callout>
      ) : null}
      {query.saved ? <Callout tone="success">{t(`tax.saved.${query.saved}`)}</Callout> : null}
      <Callout>{templates.warning}</Callout>

      <Card>
        <CardHeader title={t("tax.templates")} />
        <CardBody>
          <p className="mb-4 text-sm text-ink-muted">{t("tax.templates.intro")}</p>
          <form className="mb-4 grid gap-3 sm:grid-cols-[1fr_auto]">
            <Select name="group" defaultValue={group ?? ""} aria-label={t("tax.group")}>
              <option value="">{t("tax.group.all")}</option>
              {GROUPS.map((key) => (
                <option key={key} value={key}>{t(`tax.group.${key}`)}</option>
              ))}
            </Select>
            <button className="rounded-md border border-rule px-4 py-2 text-sm font-semibold" type="submit">
              {t("invoices.filter.apply")}
            </button>
          </form>
          <div className="grid gap-4">
            {grouped.map((entry) => (
              <details key={entry.key} className="rounded-md border border-rule p-3" open={Boolean(group) || entry.key === "canada"}>
                <summary className="cursor-pointer font-semibold">
                  {t(`tax.group.${entry.key}`)} ({entry.templates.length})
                </summary>
                <ul className="mt-3 grid list-none gap-3 p-0">
                  {entry.templates.map((template) => (
                    <li key={template.key} className="rounded-md border border-rule p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium">{template.name}</p>
                        {installed.has(template.key) ? <Pill tone="success">{t("tax.installed")}</Pill> : null}
                      </div>
                      <p className="mt-1 text-xs text-ink-muted">
                        {t("tax.source")}: {template.source.authority} · {template.source.checkedOn}
                      </p>
                      <p className="mt-1 text-xs text-ink-muted">
                        {template.rates.map((rate) => `${rate.name} ${formatPpm(rate.ratePpm)}`).join(" · ")}
                      </p>
                      {template.activationLimitation ? (
                        <p className="mt-2 text-sm">{template.activationLimitation}</p>
                      ) : null}
                      {canManage && !installed.has(template.key) ? (
                        <form action={taxAction} className="mt-3">
                          <input type="hidden" name="intent" value="install" />
                          <input type="hidden" name="key" value={template.key} />
                          <Button type="submit">{t("tax.installNamed", { name: template.name })}</Button>
                        </form>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </details>
            ))}
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("tax.categories")} />
        <CardBody>
          {configuration.categories.length === 0 ? (
            <p className="text-sm text-ink-muted">{t("tax.categories.empty")}</p>
          ) : (
            <ul className="mb-4 grid list-none gap-2 p-0 text-sm">
              {configuration.categories.map((category) => (
                <li key={category.id}>
                  <span className="font-medium">{category.name}</span>
                  <span className="ms-2 font-mono text-xs text-ink-muted">{category.code}</span>
                </li>
              ))}
            </ul>
          )}
          {canManage ? (
            <form action={taxAction} className="grid gap-4 sm:grid-cols-3">
              <input type="hidden" name="intent" value="category" />
              <Field label={t("tax.category.code")} htmlFor="category-code">
                <Input id="category-code" name="code" required className="font-mono" />
              </Field>
              <Field label={t("tax.category.name")} htmlFor="category-name">
                <Input id="category-name" name="name" required />
              </Field>
              <div className="self-end"><Button type="submit">{t("tax.category.create")}</Button></div>
            </form>
          ) : null}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("tax.zones")} />
        <CardBody>
          {configuration.zones.length === 0 ? (
            <p className="text-sm text-ink-muted">{t("tax.zones.empty")}</p>
          ) : (
            <ul className="mb-4 grid list-none gap-2 p-0 text-sm">
              {configuration.zones.map((zone) => (
                <li key={zone.id} className="flex flex-wrap gap-2">
                  <span className="font-medium">{zone.name}</span>
                  <span className="text-ink-muted">{zone.country}{zone.regions.length ? ` · ${zone.regions.join(", ")}` : ""}</span>
                  <Pill>{zone.pricesIncludeTax ? t("tax.inclusive") : t("tax.exclusive")}</Pill>
                </li>
              ))}
            </ul>
          )}
          {canManage ? (
            <form action={taxAction} className="grid gap-4 sm:grid-cols-2">
              <input type="hidden" name="intent" value="zone" />
              <Field label={t("tax.zone.name")} htmlFor="zone-name"><Input id="zone-name" name="name" required /></Field>
              <Field label={t("tax.zone.country")} htmlFor="zone-country">
                <Input id="zone-country" name="country" required maxLength={2} defaultValue={business?.country ?? ""} className="font-mono uppercase" />
              </Field>
              <Field label={t("tax.zone.regions")} htmlFor="zone-regions" hint={t("tax.zone.regionsHint")}>
                <Input id="zone-regions" name="regions" />
              </Field>
              <Field label={t("tax.zone.basis")} htmlFor="zone-basis">
                <Select id="zone-basis" name="basis" defaultValue="destination">
                  <option value="destination">{t("tax.zone.basis.destination")}</option>
                  <option value="origin">{t("tax.zone.basis.origin")}</option>
                </Select>
              </Field>
              <label className="flex items-start gap-2 text-sm sm:col-span-2">
                <input type="checkbox" name="pricesIncludeTax" value="yes" className="mt-1" />
                {t("tax.zone.includeTax")}
              </label>
              <div><Button type="submit">{t("tax.zone.create")}</Button></div>
            </form>
          ) : null}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("tax.rates")} />
        <CardBody>
          {configuration.rates.length === 0 ? (
            <p className="text-sm text-ink-muted">{t("tax.rates.empty")}</p>
          ) : (
            <ul className="mb-4 grid list-none gap-2 p-0 text-sm">
              {configuration.rates.map((rate) => (
                <li key={rate.id}>
                  {rate.name} · {formatPpm(rate.ratePpm)} · {zoneName.get(rate.zoneId) ?? rate.zoneId}
                </li>
              ))}
            </ul>
          )}
          {canManage && configuration.zones.length > 0 ? (
            <form action={taxAction} className="grid gap-4 sm:grid-cols-2">
              <input type="hidden" name="intent" value="rate" />
              <Field label={t("tax.rate.zone")} htmlFor="rate-zone">
                <Select id="rate-zone" name="zoneId" required>
                  {configuration.zones.map((zone) => <option key={zone.id} value={zone.id}>{zone.name}</option>)}
                </Select>
              </Field>
              <Field label={t("tax.rate.category")} htmlFor="rate-category">
                <Select id="rate-category" name="categoryId">
                  <option value="">{t("tax.rate.categoryAny")}</option>
                  {configuration.categories.map((category) => (
                    <option key={category.id} value={category.id}>{category.name}</option>
                  ))}
                </Select>
              </Field>
              <Field label={t("tax.rate.name")} htmlFor="rate-name"><Input id="rate-name" name="name" required /></Field>
              <Field label={t("tax.rate.jurisdiction")} htmlFor="rate-jurisdiction"><Input id="rate-jurisdiction" name="jurisdiction" required /></Field>
              <Field label={t("tax.rate.percent")} htmlFor="rate-percent" hint={t("tax.rate.percentHint")}>
                <Input id="rate-percent" name="ratePercent" inputMode="decimal" required placeholder="5" />
              </Field>
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" name="appliesToShipping" value="yes" className="mt-1" />
                {t("tax.rate.shipping")}
              </label>
              <div className="sm:col-span-2"><Button type="submit">{t("tax.rate.create")}</Button></div>
            </form>
          ) : null}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("tax.registrations")} />
        <CardBody>
          {configuration.registrations.length === 0 ? (
            <p className="text-sm text-ink-muted">{t("tax.registrations.empty")}</p>
          ) : (
            <ul className="grid list-none gap-4 p-0">
              {configuration.registrations.map((registration) => (
                <li key={registration.id} className="rounded-md border border-rule p-3">
                  <div className="mb-3 flex flex-wrap gap-2">
                    <span className="font-medium">{zoneName.get(registration.zoneId) ?? registration.zoneId}</span>
                    <Pill tone={registration.status === "active" ? "success" : "warning"}>
                      {t(`tax.registration.status.${registration.status}`)}
                    </Pill>
                  </div>
                  {canManage ? (
                    <form action={taxAction} className="grid gap-4">
                      <input type="hidden" name="intent" value="registration" />
                      <input type="hidden" name="id" value={registration.id} />
                      <input type="hidden" name="zoneId" value={registration.zoneId} />
                      <div className="grid gap-4 sm:grid-cols-2">
                        <Field label={t("tax.registration.number")} htmlFor={`reg-number-${registration.id}`}>
                          <Input id={`reg-number-${registration.id}`} name="number" defaultValue={registration.number ?? ""} />
                        </Field>
                        <Field label={t("tax.registration.status")} htmlFor={`reg-status-${registration.id}`}>
                          <Select id={`reg-status-${registration.id}`} name="status" defaultValue={registration.status}>
                            {["monitoring", "active", "paused", "closed"].map((status) => (
                              <option key={status} value={status}>{t(`tax.registration.status.${status}`)}</option>
                            ))}
                          </Select>
                        </Field>
                      </div>
                      <label className="flex items-start gap-2 text-sm">
                        <input type="checkbox" name="acknowledge" value="yes" className="mt-1" />
                        {t("tax.registration.acknowledge")}
                      </label>
                      <div><Button type="submit">{t("tax.registration.save")}</Button></div>
                    </form>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("tax.thresholds")} />
        <CardBody>
          {thresholds.thresholds.length === 0 ? (
            <p className="text-sm text-ink-muted">{t("tax.thresholds.empty")}</p>
          ) : (
            <ul className="grid list-none gap-3 p-0 text-sm">
              {thresholds.thresholds.map((row) => (
                <li key={row.registration.id}>
                  <span className="font-medium">{row.zone.name}</span>
                  <span className="ms-2">{t(`tax.thresholds.state.${row.state}`)}</span>
                  {row.registration.thresholdCurrency ? (
                    <span className="ms-2 font-mono text-xs">
                      {money(row.grossSalesMinor, row.registration.thresholdCurrency)}
                    </span>
                  ) : null}
                  <p className="mt-1 text-xs text-ink-muted">{row.explanation}</p>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("tax.exemptions")} />
        <CardBody>
          {configuration.exemptions.length === 0 ? (
            <p className="text-sm text-ink-muted">{t("tax.exemptions.empty")}</p>
          ) : (
            <ul className="mb-4 grid list-none gap-2 p-0 text-sm">
              {configuration.exemptions.map((exemption) => (
                <li key={exemption.id}>
                  {exemption.kind} · {exemption.status} · {zoneName.get(exemption.zoneId) ?? exemption.zoneId}
                </li>
              ))}
            </ul>
          )}
          {canManage && configuration.zones.length > 0 && contacts.rows.length > 0 ? (
            <form action={taxAction} className="grid gap-4 sm:grid-cols-2">
              <input type="hidden" name="intent" value="exemption" />
              <Field label={t("tax.exemption.contact")} htmlFor="ex-contact">
                <Select id="ex-contact" name="contactId" required>
                  {contacts.rows.map((contact) => (
                    <option key={contact.id} value={contact.id}>{contact.name}</option>
                  ))}
                </Select>
              </Field>
              <Field label={t("tax.exemption.zone")} htmlFor="ex-zone">
                <Select id="ex-zone" name="zoneId" required>
                  {configuration.zones.map((zone) => <option key={zone.id} value={zone.id}>{zone.name}</option>)}
                </Select>
              </Field>
              <Field label={t("tax.exemption.kind")} htmlFor="ex-kind">
                <Select id="ex-kind" name="kind" required>
                  {["reseller", "nonprofit", "reverse_charge", "diplomatic"].map((kind) => (
                    <option key={kind} value={kind}>{t(`tax.exemption.kind.${kind}`)}</option>
                  ))}
                </Select>
              </Field>
              <Field label={t("tax.exemption.status")} htmlFor="ex-status">
                <Select id="ex-status" name="status" required defaultValue="pending">
                  {["pending", "valid", "expired", "revoked"].map((status) => (
                    <option key={status} value={status}>{t(`tax.exemption.status.${status}`)}</option>
                  ))}
                </Select>
              </Field>
              <Field label={t("tax.exemption.certificate")} htmlFor="ex-cert">
                <Input id="ex-cert" name="certificateRef" />
              </Field>
              <Field label={t("tax.exemption.validatedAt")} htmlFor="ex-validated">
                <Input id="ex-validated" name="validatedAt" type="datetime-local" />
              </Field>
              <div className="sm:col-span-2"><Button type="submit">{t("tax.exemption.create")}</Button></div>
            </form>
          ) : null}
        </CardBody>
      </Card>
    </div>
  );
}
