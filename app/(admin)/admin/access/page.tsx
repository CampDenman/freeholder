// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// What a person may use, computed from grants (MASTER.md §4.15, C9.14).
import type { Metadata } from "next";
import { Key } from "@phosphor-icons/react/dist/ssr";
import { Button, Card, CardBody, CardHeader, Field, Input, Pill, Select } from "@/ui/primitives";
import { listContacts } from "@/core/contacts/service";
import { listEntitlements, listGrants } from "@/core/entitlements/service";
import { currentBusiness } from "@/core/settings/read";
import { getT } from "../../../i18n";
import { requireStaffActor } from "../guard";
import { domainOrNull } from "../../read-helpers";
import {
  grantAccessAction,
  revokeGrantAction,
  saveEntitlementAction,
} from "../../entitlement-actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function AccessPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; saved?: string; granted?: string; revoked?: string }>;
}) {
  const actor = await requireStaffActor("entitlements", "manage");
  const query = await searchParams;
  const [t, business, catalogue, grants, contacts] = await Promise.all([
    getT(),
    currentBusiness(),
    domainOrNull(listEntitlements.call({ limit: 100 }, actor)),
    domainOrNull(listGrants.call({ limit: 100 }, actor)),
    listContacts.call({ limit: 100 }, actor).catch(() => ({ rows: [], total: 0 })),
  ]);
  const locale = business?.defaultLocale ?? "en";
  const when = (value: Date | string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: business?.timezone ?? "UTC" }).format(
      new Date(value),
    );

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight">
          <Key size={22} weight="duotone" className="text-accent" />
          {t("entitlements.title")}
        </h1>
        <p className="mt-1 max-w-prose text-sm text-ink-muted">{t("entitlements.intro")}</p>
      </div>

      {query.error ? (
        <p className="rounded-md border border-danger bg-danger-soft px-3 py-2 text-sm text-danger">
          {query.error}
        </p>
      ) : null}
      {query.saved ? (
        <p className="rounded-md border border-success bg-success-soft px-3 py-2 text-sm text-success">
          {t("entitlements.saved")}
        </p>
      ) : null}
      {query.granted ? (
        <p className="rounded-md border border-success bg-success-soft px-3 py-2 text-sm text-success">
          {t("entitlements.granted")}
        </p>
      ) : null}
      {query.revoked ? (
        <p className="rounded-md border border-success bg-success-soft px-3 py-2 text-sm text-success">
          {t("entitlements.revoked")}
        </p>
      ) : null}

      <Card>
        <CardHeader title={t("entitlements.catalogue")} />
        <CardBody>
          {(catalogue ?? []).length === 0 ? (
            <p className="text-sm text-ink-muted">{t("entitlements.noCatalogue")}</p>
          ) : (
            <ul className="grid list-none gap-2 p-0">
              {(catalogue ?? []).map((item) => (
                <li
                  key={item.id}
                  className="flex flex-wrap items-center gap-3 rounded-md border border-rule p-3 text-sm"
                >
                  <span className="font-semibold text-ink">{item.name}</span>
                  <span className="text-ink-muted">
                    {item.grantorType} · {item.resource.kind}
                    {item.resource.selector ? ` / ${item.resource.selector}` : ""}
                  </span>
                  <Pill tone={item.status === "active" ? "success" : "neutral"}>
                    {t(`entitlements.status.${item.status}`)}
                  </Pill>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("entitlements.new")} />
        <CardBody>
          <form action={saveEntitlementAction} className="grid gap-3 md:grid-cols-3">
            <Field label={t("entitlements.field.name")} htmlFor="name">
              <Input id="name" name="name" required maxLength={200} />
            </Field>
            <Field label={t("entitlements.field.grantorType")} htmlFor="grantorType">
              <Select id="grantorType" name="grantorType" defaultValue="manual">
                <option value="manual">{t("entitlements.grantor.manual")}</option>
                <option value="plan">{t("entitlements.grantor.plan")}</option>
                <option value="pass">{t("entitlements.grantor.pass")}</option>
                <option value="tier">{t("entitlements.grantor.tier")}</option>
                <option value="unlock">{t("entitlements.grantor.unlock")}</option>
              </Select>
            </Field>
            <Field label={t("entitlements.field.grantorId")} htmlFor="grantorId">
              <Input id="grantorId" name="grantorId" required />
            </Field>
            <Field label={t("entitlements.field.kind")} htmlFor="kind">
              <Input id="kind" name="kind" defaultValue="site" required maxLength={40} />
            </Field>
            <Field label={t("entitlements.field.selector")} htmlFor="selector">
              <Input id="selector" name="selector" maxLength={200} />
            </Field>
            <div className="self-end">
              <Button type="submit">{t("entitlements.action.save")}</Button>
            </div>
          </form>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("entitlements.grantTitle")} />
        <CardBody>
          {contacts.rows.length === 0 || (catalogue ?? []).length === 0 ? (
            <p className="text-sm text-ink-muted">{t("entitlements.grantMissing")}</p>
          ) : (
            <form action={grantAccessAction} className="grid gap-3 md:grid-cols-3">
              <Field label={t("entitlements.field.contact")} htmlFor="contactId">
                <Select id="contactId" name="contactId" required defaultValue="">
                  <option value="">{t("entitlements.chooseContact")}</option>
                  {contacts.rows.map((contact) => (
                    <option key={contact.id} value={contact.id}>
                      {contact.name}
                      {contact.email ? ` · ${contact.email}` : ""}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t("entitlements.field.entitlement")} htmlFor="entitlementId">
                <Select id="entitlementId" name="entitlementId" required defaultValue="">
                  <option value="">{t("entitlements.chooseEntitlement")}</option>
                  {(catalogue ?? [])
                    .filter((item) => item.status === "active")
                    .map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                </Select>
              </Field>
              <div className="self-end">
                <Button type="submit">{t("entitlements.action.grant")}</Button>
              </div>
            </form>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("entitlements.holding")} />
        <CardBody>
          {(grants ?? []).length === 0 ? (
            <p className="text-sm text-ink-muted">{t("entitlements.noGrants")}</p>
          ) : (
            <ul className="grid list-none gap-2 p-0">
              {(grants ?? []).map((grant) => (
                <li
                  key={grant.id}
                  className="flex flex-wrap items-center gap-3 rounded-md border border-rule p-3 text-sm"
                >
                  <Pill
                    tone={
                      grant.status === "active"
                        ? "success"
                        : grant.status === "paused"
                          ? "warning"
                          : "neutral"
                    }
                  >
                    {t(`entitlements.grantStatus.${grant.status}`)}
                  </Pill>
                  <span className="text-ink-muted">
                    {grant.endsAt
                      ? t("entitlements.until", { date: when(grant.endsAt) })
                      : t("entitlements.openEnded")}
                  </span>
                  {grant.status === "active" || grant.status === "paused" ? (
                    <form action={revokeGrantAction} className="ms-auto">
                      <input type="hidden" name="id" value={grant.id} />
                      <Button type="submit" variant="quiet">
                        {t("entitlements.action.revoke")}
                      </Button>
                    </form>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
