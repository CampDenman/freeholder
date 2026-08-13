// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Owner privacy desk: consent evidence and deadline-bearing rights requests.
import type { Metadata } from "next";
import { ShieldCheck, UserFocus } from "@phosphor-icons/react/dist/ssr";
import { formatDateTime } from "@/core/i18n";
import { listDataRequests } from "@/core/privacy/service";
import { hasModuleAccess } from "@/core/service";
import { currentBusiness } from "@/core/settings/read";
import { Card, CardBody, CardHeader, Field, Input, Pill, Select } from "@/ui/primitives";
import { getT } from "../../../../i18n";
import { requireStaffActor } from "../../guard";
import { PrivacyActionForm } from "./PrivacyActionForm";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("privacy.title"), robots: { index: false, follow: false } };
}
const PAGE_SIZE = 50;
const STATUSES = [
  "submitted",
  "verified",
  "in_progress",
  "completed",
  "partially_completed",
  "denied",
  "cancelled",
] as const;

function tone(status: string) {
  if (status === "completed") return "success" as const;
  if (status === "partially_completed" || status === "submitted") return "warning" as const;
  if (status === "denied") return "danger" as const;
  if (status === "verified" || status === "in_progress") return "accent" as const;
  return "neutral" as const;
}

export default async function PrivacyDeskPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requireStaffActor("contacts");
  const params = await searchParams;
  const one = (key: string) => {
    const value = params[key];
    return (Array.isArray(value) ? value[0] : value) ?? "";
  };
  const contactId = one("contactId");
  const rawStatus = one("status");
  const status = STATUSES.includes(rawStatus as (typeof STATUSES)[number])
    ? (rawStatus as (typeof STATUSES)[number])
    : undefined;
  const offset = Math.max(0, Number(one("offset")) || 0);
  const [t, business, rows] = await Promise.all([
    getT(),
    currentBusiness(),
    listDataRequests.call(
      { status, contactId: contactId || undefined, limit: PAGE_SIZE, offset },
      actor,
    ),
  ]);
  const canManage = hasModuleAccess(actor, "contacts", "manage");
  const timezone = business?.timezone ?? "UTC";
  const locale = business?.defaultLocale ?? "en";

  return (
    <div className="grid gap-6">
      <div>
        <a href="/admin/contacts" className="text-sm text-ink-muted">
          {t("privacy.back")}
        </a>
        <h1 className="mt-2 text-xl font-bold tracking-tight">{t("privacy.title")}</h1>
        <p className="mt-1 max-w-3xl text-sm text-ink-muted">{t("privacy.intro")}</p>
      </div>

      {canManage ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader icon={<UserFocus size={17} weight="bold" />} title={t("privacy.request.new")} />
            <CardBody>
              <p className="text-sm text-ink-muted">{t("privacy.request.newHint")}</p>
              <PrivacyActionForm
                intent="create"
                submitLabel={t("privacy.request.create")}
                pendingLabel={t("privacy.working")}
              >
                <Field label={t("privacy.contactId")} htmlFor="privacy-request-contact">
                  <Input id="privacy-request-contact" name="contactId" required defaultValue={contactId} />
                </Field>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label={t("privacy.request.kind")} htmlFor="privacy-request-kind">
                    <Select id="privacy-request-kind" name="kind" defaultValue="access">
                      {(["access", "export", "correction", "erasure"] as const).map((kind) => (
                        <option key={kind} value={kind}>{t(`privacy.kind.${kind}`)}</option>
                      ))}
                    </Select>
                  </Field>
                  <Field label={t("privacy.jurisdiction")} htmlFor="privacy-request-jurisdiction">
                    <Input id="privacy-request-jurisdiction" name="jurisdiction" placeholder={t("privacy.jurisdictionPlaceholder")} />
                  </Field>
                </div>
                <Field label={t("privacy.note")} htmlFor="privacy-request-note" hint={t("privacy.request.correctionHint")}>
                  <textarea id="privacy-request-note" name="note" rows={3} className="w-full rounded-md border border-rule bg-field px-3 py-2 text-sm" />
                </Field>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label={t("contacts.field.name")} htmlFor="privacy-correction-name">
                    <Input id="privacy-correction-name" name="name" />
                  </Field>
                  <Field label={t("contacts.field.email")} htmlFor="privacy-correction-email">
                    <Input id="privacy-correction-email" name="email" type="email" />
                  </Field>
                  <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" name="clearEmail" />{t("privacy.portal.clearEmail")}</label>
                  <Field label={t("contacts.field.phone")} htmlFor="privacy-correction-phone">
                    <Input id="privacy-correction-phone" name="phone" />
                  </Field>
                  <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" name="clearPhone" />{t("privacy.portal.clearPhone")}</label>
                  <Field label={t("contacts.field.country")} htmlFor="privacy-correction-country">
                    <Input id="privacy-correction-country" name="country" maxLength={2} />
                  </Field>
                  <Field label={t("contacts.field.preferredLocale")} htmlFor="privacy-correction-locale">
                    <Input id="privacy-correction-locale" name="preferredLocale" />
                  </Field>
                  <Field label={t("contacts.field.timezone")} htmlFor="privacy-correction-timezone">
                    <Input id="privacy-correction-timezone" name="timezone" />
                  </Field>
                </div>
              </PrivacyActionForm>
            </CardBody>
          </Card>

          <Card>
            <CardHeader icon={<ShieldCheck size={17} weight="bold" />} title={t("privacy.consent.record")} />
            <CardBody>
              <p className="text-sm text-ink-muted">{t("privacy.consent.hint")}</p>
              <PrivacyActionForm
                intent="consent"
                submitLabel={t("privacy.consent.save")}
                pendingLabel={t("privacy.working")}
              >
                <Field label={t("privacy.contactId")} htmlFor="privacy-consent-contact">
                  <Input id="privacy-consent-contact" name="contactId" required defaultValue={contactId} />
                </Field>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label={t("privacy.consent.purpose")} htmlFor="privacy-consent-purpose">
                    <Select id="privacy-consent-purpose" name="purpose" defaultValue="marketing">
                      {(["marketing", "analytics", "data_processing"] as const).map((purpose) => (
                        <option key={purpose} value={purpose}>{t(`privacy.purpose.${purpose}`)}</option>
                      ))}
                    </Select>
                  </Field>
                  <Field label={t("privacy.consent.channel")} htmlFor="privacy-consent-channel">
                    <Select id="privacy-consent-channel" name="channel" defaultValue="email">
                      <option value="">{t("privacy.channel.none")}</option>
                      {(["email", "sms", "push", "web"] as const).map((channel) => (
                        <option key={channel} value={channel}>{t(`privacy.channel.${channel}`)}</option>
                      ))}
                    </Select>
                  </Field>
                  <Field label={t("privacy.consent.state")} htmlFor="privacy-consent-state">
                    <Select id="privacy-consent-state" name="state" defaultValue="granted">
                      {(["granted", "denied", "withdrawn"] as const).map((state) => (
                        <option key={state} value={state}>{t(`privacy.consent.${state}`)}</option>
                      ))}
                    </Select>
                  </Field>
                  <Field label={t("privacy.consent.method")} htmlFor="privacy-consent-method">
                    <Select id="privacy-consent-method" name="method" defaultValue="written">
                      {(["form", "double_opt_in", "verbal", "written", "contract", "import"] as const).map((method) => (
                        <option key={method} value={method}>{t(`privacy.method.${method}`)}</option>
                      ))}
                    </Select>
                  </Field>
                </div>
                <Field label={t("privacy.consent.termsVersion")} htmlFor="privacy-consent-terms">
                  <Input id="privacy-consent-terms" name="termsVersion" />
                </Field>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label={t("privacy.consent.sourceUrl")} htmlFor="privacy-consent-source">
                    <Input id="privacy-consent-source" name="sourceUrl" type="url" />
                  </Field>
                  <Field label={t("privacy.consent.expiry")} htmlFor="privacy-consent-expiry">
                    <Input id="privacy-consent-expiry" name="expiresAt" type="datetime-local" />
                  </Field>
                </div>
                <Field label={t("privacy.consent.evidence")} htmlFor="privacy-consent-evidence">
                  <textarea id="privacy-consent-evidence" name="evidenceNote" rows={2} className="w-full rounded-md border border-rule bg-field px-3 py-2 text-sm" />
                </Field>
              </PrivacyActionForm>
            </CardBody>
          </Card>
        </div>
      ) : null}

      <Card>
        <CardHeader title={t("privacy.queue")} status={<Pill>{rows.length}</Pill>} />
        <CardBody>
          <form method="get" className="flex flex-wrap items-end gap-3">
            <Field label={t("privacy.status")} htmlFor="privacy-status-filter">
              <Select id="privacy-status-filter" name="status" defaultValue={status ?? ""}>
                <option value="">{t("privacy.status.all")}</option>
                {STATUSES.map((value) => <option key={value} value={value}>{t(`privacy.status.${value}`)}</option>)}
              </Select>
            </Field>
            {contactId ? <input type="hidden" name="contactId" value={contactId} /> : null}
            <button className="rounded-md border border-rule px-4 py-2 text-sm font-semibold" type="submit">
              {t("common.filter")}
            </button>
          </form>
          {rows.length === 0 ? (
            <p className="text-sm text-ink-muted">{t("privacy.empty")}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-2xl border-collapse text-sm">
                <thead><tr className="border-b border-rule text-start">
                  <th className="px-3 py-2 text-start">{t("privacy.person")}</th>
                  <th className="px-3 py-2 text-start">{t("privacy.request.kind")}</th>
                  <th className="px-3 py-2 text-start">{t("privacy.status")}</th>
                  <th className="px-3 py-2 text-start">{t("privacy.due")}</th>
                </tr></thead>
                <tbody>{rows.map(({ request, contact }) => (
                  <tr key={request.id} className="border-b border-rule last:border-0">
                    <td className="px-3 py-3"><a className="font-medium underline" href={`/admin/contacts/${contact.id}`}>{contact.name}</a></td>
                    <td className="px-3 py-3"><a className="underline" href={`/admin/contacts/privacy/${request.id}`}>{t(`privacy.kind.${request.kind}`)}</a></td>
                    <td className="px-3 py-3"><Pill tone={tone(request.status)}>{t(`privacy.status.${request.status}`)}</Pill></td>
                    <td className="px-3 py-3 font-mono text-xs tabular-nums">{formatDateTime(request.responseDueAt, timezone, locale)}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
          <div className="flex gap-3 text-sm">
            {offset > 0 ? <a href={`?offset=${Math.max(0, offset - PAGE_SIZE)}${status ? `&status=${status}` : ""}`} className="underline">{t("common.previous")}</a> : null}
            {rows.length === PAGE_SIZE ? <a href={`?offset=${offset + PAGE_SIZE}${status ? `&status=${status}` : ""}`} className="underline">{t("common.next")}</a> : null}
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
