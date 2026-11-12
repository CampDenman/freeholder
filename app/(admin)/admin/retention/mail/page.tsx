// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import type { Metadata } from "next";
import { listLegacyMailRecords } from "@/core/mail/record-services";
import { getContact, listContacts } from "@/core/contacts/service";
import { Button, Card, CardBody, Field, Input, Select } from "@/ui/primitives";
import { getLocale, getT } from "../../../../i18n";
import { requireStaffActor } from "../../guard";
import { domainOrNull } from "../../../read-helpers";
import { reviewMailOwnershipAction } from "../../../mail-retention-actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };
export default async function MailOwnershipPage({ searchParams }: { searchParams: Promise<{ recipient?: string; search?: string; contactId?: string; saved?: string; error?: string }> }) {
  const actor = await requireStaffActor("mail", "manage"), query = await searchParams, t = await getT();
  const [records, people, selected, locale] = await Promise.all([
    domainOrNull(listLegacyMailRecords.call({ ...(query.recipient ? { recipient: query.recipient } : {}), limit: 25 }, actor)),
    domainOrNull(listContacts.call({ ...(query.search ? { search: query.search } : {}), limit: 100 }, actor)),
    query.contactId ? domainOrNull(getContact.call({ id: query.contactId }, actor)) : null,
    getLocale(),
  ]);
  const choices = selected && people && !people.rows.some(person => person.id === selected.id) ? [selected, ...people.rows] : people?.rows ?? [];
  const canReview = actor.kind === "user" && Boolean(actor.security?.stepUpValid);
  const reviewPath = `/admin/retention/mail${selected ? `?contactId=${encodeURIComponent(selected.id)}` : ""}`;
  const date = (value: Date) => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(value);
  return <div className="grid gap-6">
    <div><h1 className="text-xl font-bold">{t("admin.retention.mail.title")}</h1><p className="mt-2 max-w-prose text-sm text-ink-muted">{t("admin.retention.mail.intro")}</p></div>
    <a className="text-sm underline" href="/admin/retention/mail/recovery">{t("mail.recovery.link")}</a>
    <a className="text-sm underline" href="/admin/retention/mail/carriers">{t("mail.carrier.title")}</a>
    {query.saved ? <p role="status">{t("admin.retention.mail.saved")}</p> : null}
    {query.error ? <p role="alert" className="text-danger">{t("admin.retention.mail.failed")}</p> : null}
    {!canReview ? <a className="text-sm underline" href={`/security/verify?returnTo=${encodeURIComponent(reviewPath)}`}>{t("security.verify.title")}</a> : null}
    <form method="get" className="grid gap-3 sm:grid-cols-2">
      {selected ? <input type="hidden" name="contactId" value={selected.id} /> : null}
      <Field label={t("admin.retention.mail.address")} htmlFor="mail-recipient"><Input id="mail-recipient" name="recipient" type="email" defaultValue={query.recipient} /></Field>
      <Field label={t("admin.retention.mail.search")} htmlFor="mail-contact-search"><Input id="mail-contact-search" name="search" defaultValue={query.search} /></Field>
      <Button type="submit">{t("admin.retention.mail.find")}</Button>
    </form>
    {!records || !people ? <p role="alert">{t("admin.retention.mail.unavailable")}</p> : records.rows.length === 0 ? <p>{t("admin.retention.mail.empty")}</p> : records.rows.map(record => <Card key={`${record.kind}:${record.id}`}>
      <div className="border-b border-rule bg-surface-muted px-4 py-3"><h2 className="break-all text-sm font-semibold">{record.recipient}</h2></div>
      <CardBody>
        <p className="break-words text-sm">{record.subject || t("admin.retention.mail.record")}</p>
        <p className="text-sm text-ink-muted">{date(record.createdAt)}</p>
        <form action={reviewMailOwnershipAction} className="mt-4 grid min-w-0 gap-3">
          <input type="hidden" name="kind" value={record.kind} /><input type="hidden" name="id" value={record.id} /><input type="hidden" name="expectedRecipient" value={record.recipient} />
          <Field label={t("admin.retention.mail.contact")} htmlFor={`mail-contact-${record.id}`}>
            <Select id={`mail-contact-${record.id}`} name="contactId" required defaultValue={selected?.id ?? ""}><option value="">{t("admin.retention.mail.choose")}</option>{choices.map(person => <option key={person.id} value={person.id}>{person.name}{person.email ? ` · ${person.email}` : ` · ${date(person.createdAt)}`}</option>)}</Select>
          </Field>
          <Field label={t("admin.retention.mail.evidence")} htmlFor={`mail-evidence-${record.id}`}><textarea id={`mail-evidence-${record.id}`} name="evidence" required minLength={20} maxLength={4000} rows={3} className="w-full min-w-0 rounded-md border border-rule bg-field p-2" /></Field>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="confirmation" value="VERIFIED" required className="mt-1" /><span>{t("admin.retention.mail.confirm")}</span></label>
          <Button type="submit" disabled={!canReview}>{t("admin.retention.mail.review")}</Button>
        </form>
      </CardBody>
    </Card>)}
  </div>;
}
