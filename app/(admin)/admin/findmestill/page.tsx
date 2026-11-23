// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import type { Metadata } from "next";
import { listContacts } from "@/core/contacts/service";
import { findMeStillPublicationUrl, listFindMeStillDesks, readFindMeStillCustomerLink } from "@/core/findmestill/service";
import { listRoleUsers } from "@/core/roles/service";
import { listBookings } from "@/core/scheduling/bookings";
import { hasModuleAccess } from "@/core/service";
import { currentBusiness } from "@/core/settings/read";
import { Button, Card, CardBody, CardHeader, Field, Input, Pill, Select } from "@/ui/primitives";
import { getLocale, getT } from "../../../i18n";
import { requireStaffActor } from "../guard";
import { linkCustomerAction, openBookingAction, saveCardAction, setGrantAction } from "./actions";
import { DeskPublication } from "./DeskPublication";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

const pageRoute = "/admin/findmestill";
const reported = new Set(["saved", "confirmed", "retained", "published", "granted", "revoked", "linked", "refused", "verify"]);

export default async function FindMeStillPage({ searchParams }: {
  searchParams: Promise<{ desk?: string; status?: string; customer?: string }>;
}) {
  const actor = await requireStaffActor("findMeStill");
  const [params, desks, t, locale, business] = await Promise.all([
    searchParams, listFindMeStillDesks.call({}, actor), getT(), getLocale(), currentBusiness(),
  ]);
  const selected = desks.find((desk) => desk.identity === params.desk) ?? desks[0];
  const canManage = hasModuleAccess(actor, "findMeStill", "manage");
  const canSeeContact = hasModuleAccess(actor, "contacts");
  const canSeeBooking = hasModuleAccess(actor, "bookings") && hasModuleAccess(actor, "scheduling");
  const canGrant = canManage && hasModuleAccess(actor, "roles");
  const customerSearch = typeof params.customer === "string" ? params.customer.slice(0, 200) : "";
  const [accounts, customers, linked] = await Promise.all([
    selected && canGrant ? listRoleUsers.call({}, actor) : Promise.resolve([]),
    selected?.granted && canManage && canSeeContact
      ? listContacts.call({ limit: 25, search: customerSearch || undefined }, actor) : Promise.resolve(null),
    selected?.granted && canSeeContact
      ? readFindMeStillCustomerLink.call({ identity: selected.identity }, actor) : Promise.resolve(null),
  ]);
  const bookings = linked && canSeeBooking ? await listBookings.call({ contactId: linked.contactId, limit: 25 }, actor) : [];
  const now = Math.floor(Date.now() / 1_000);
  const when = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium", timeStyle: "short", timeZone: business?.timezone ?? "UTC",
  });
  const status = typeof params.status === "string" && reported.has(params.status) ? params.status : undefined;
  const activeIdentity = selected?.identity;

  return (
    <div className="grid gap-6">
      <header>
        <h1 className="text-xl font-bold tracking-tight">{t("findMeStill.title")}</h1>
        <p className="mt-1 text-sm text-ink-muted">{t("findMeStill.site", { site: business?.name ?? t("common.appName") })}</p>
      </header>
      {status && (
        <p role={status === "refused" ? "alert" : "status"} className="text-sm text-ink">
          {t(`findMeStill.status.${status}`)}{" "}
          {status === "verify" && <a className="underline" href="/security/verify?returnTo=/admin/findmestill">{t("findMeStill.verify")}</a>}
        </p>
      )}
      <div className="grid gap-4 lg:grid-cols-[minmax(14rem,1fr)_minmax(0,2fr)]">
        <Card>
          <CardHeader title={t("findMeStill.desks")} />
          <CardBody>
            {desks.length === 0 ? <p className="text-sm text-ink-muted">{t("findMeStill.empty")}</p> : (
              <ul className="grid gap-2">
                {desks.map((desk) => (
                  <li key={desk.identity}>
                    <a href={`${pageRoute}?desk=${desk.identity}`} aria-current={desk.identity === activeIdentity ? "page" : undefined}
                      className="block break-all rounded-md border border-rule px-3 py-2 text-sm text-ink hover:bg-surface-muted aria-[current=page]:border-accent">
                      {new URL(desk.primaryCardUrl).hostname}
                      <span className="block font-mono text-xs text-ink-muted" dir="ltr">{desk.identity}</span>
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
        {selected && (
          <Card>
            <CardHeader title={t("findMeStill.active")} status={(
              <Pill tone={selected.expiresAt > now ? "success" : "warning"}>
                {t(selected.expiresAt > now ? "findMeStill.current" : "findMeStill.expired")}
              </Pill>
            )} />
            <CardBody>
              <dl className="grid gap-3 text-sm">
                <div><dt className="font-medium">{t("findMeStill.identity")}</dt><dd className="break-all font-mono" dir="ltr">{selected.identity}</dd></div>
                <div><dt className="font-medium">{t("findMeStill.address")}</dt><dd className="break-all" dir="ltr">{selected.primaryCardUrl}</dd></div>
                {selected.backupCardUrls.length > 0 && (
                  <div><dt className="font-medium">{t("findMeStill.backups")}</dt>
                    <dd><ul>{selected.backupCardUrls.map((url) => <li key={url} className="break-all" dir="ltr">{url}</li>)}</ul></dd>
                  </div>
                )}
                <div><dt className="font-medium">{t("findMeStill.validUntil")}</dt><dd>{when.format(new Date(selected.expiresAt * 1_000))}</dd></div>
              </dl>
              <DeskPublication status={selected.publication}
                shareUrl={`${findMeStillPublicationUrl(selected.identity)}#${selected.identity}`}
                label={t("findMeStill.share")} staleText={t("findMeStill.stalePublication")} />
            </CardBody>
          </Card>
        )}
      </div>
      {canManage && (
        <Card>
          <CardHeader title={t("findMeStill.importTitle")} />
          <CardBody>
            <form action={saveCardAction} className="grid gap-4">
              <Field htmlFor="fms-id" label={t("findMeStill.identity")} hint={t("findMeStill.introduction")}>
                <Input id="fms-id" name="identity" dir="ltr" aria-describedby="fms-id-hint" defaultValue={activeIdentity} required maxLength={48} />
              </Field>
              <Field htmlFor="fms-documents" label={t("findMeStill.documents")} hint={t("findMeStill.fileHint")}>
                <Input id="fms-documents" name="documents" type="file" accept="application/json,.json" multiple aria-describedby="fms-documents-hint" />
              </Field>
              <Field htmlFor="fms-document" label={t("findMeStill.paste")}>
                <textarea id="fms-document" name="document" dir="ltr" rows={4} maxLength={262_144}
                  className="w-full rounded-md border border-rule-strong bg-field px-3 py-2 font-mono text-base text-ink" />
              </Field>
              <p className="break-all text-sm text-ink-muted">{t("findMeStill.publishHint", { address: findMeStillPublicationUrl(activeIdentity ?? "") })}</p>
              <div className="flex flex-wrap gap-2">
                <Button type="submit" name="intent" value="save">{t("findMeStill.save")}</Button>
                <Button type="submit" variant="quiet" name="intent" value="publish">{t("findMeStill.publish")}</Button>
              </div>
            </form>
          </CardBody>
        </Card>
      )}
      {selected && canGrant && accounts.length > 0 && (
        <Card>
          <CardHeader title={t("findMeStill.access")} />
          <CardBody>
            <form action={setGrantAction} className="grid gap-4">
              <input type="hidden" name="identity" value={selected.identity} />
              <Field htmlFor="fms-user" label={t("findMeStill.account")}>
                <Select id="fms-user" name="userId" required defaultValue="">
                  <option value="" disabled>{t("findMeStill.chooseAccount")}</option>
                  {accounts.map((account) => <option value={account.id} key={account.id}>{account.email}</option>)}
                </Select>
              </Field>
              <Field htmlFor="fms-expiry" label={t("findMeStill.accessExpiry")}>
                <Input id="fms-expiry" name="expiry" type="date" />
              </Field>
              <div className="flex flex-wrap gap-2">
                <Button type="submit" name="intent" value="grant">{t("findMeStill.grant")}</Button>
                <Button type="submit" variant="quiet" name="intent" value="revoke">{t("findMeStill.revoke")}</Button>
              </div>
            </form>
          </CardBody>
        </Card>
      )}
      {selected?.granted && canSeeContact && (
        <Card>
          <CardHeader title={t("findMeStill.customer")}/>
          <CardBody>
            {linked && <a className="text-sm underline" href={`/admin/contacts/${linked.contactId}`}>{linked.name}</a>}
            {canManage && customers && (
              <>
                <form action={pageRoute} className="flex flex-wrap items-end gap-2" method="get">
                  <input type="hidden" name="desk" value={selected.identity} />
                  <Field htmlFor="fms-customer-search" label={t("findMeStill.searchCustomers")}>
                    <Input id="fms-customer-search" name="customer" defaultValue={customerSearch} maxLength={200} />
                  </Field>
                  <Button type="submit" variant="quiet">{t("findMeStill.search")}</Button>
                </form>
                <form action={linkCustomerAction} className="grid gap-4">
                  <input type="hidden" name="identity" value={selected.identity} />
                  <Field htmlFor="fms-customer" label={t("findMeStill.chooseCustomer")}>
                    <Select id="fms-customer" name="contactId" defaultValue={linked?.contactId ?? ""}>
                      <option value="">{t("findMeStill.noCustomer")}</option>
                      {linked && !customers.rows.some((contact) => contact.id === linked.contactId)
                        && <option value={linked.contactId}>{linked.name}</option>}
                      {customers.rows.map((contact) => <option value={contact.id} key={contact.id}>{contact.name}</option>)}
                    </Select>
                  </Field>
                  <div><Button type="submit">{t("findMeStill.saveCustomer")}</Button></div>
                </form>
              </>
            )}
            {linked && bookings.length > 0 && (
              <form action={openBookingAction} className="grid gap-4 border-t border-rule pt-4">
                <input type="hidden" name="identity" value={selected.identity} />
                <input type="hidden" name="contactId" value={linked.contactId} />
                <Field htmlFor="fms-booking" label={t("findMeStill.booking")}>
                  <Select id="fms-booking" name="bookingId" required defaultValue="">
                    <option value="" disabled>{t("findMeStill.chooseBooking")}</option>
                    {bookings.map((booking) => <option value={booking.id} key={booking.id}>{when.format(booking.startsAt)} · {booking.calendarName}</option>)}
                  </Select>
                </Field>
                <div><Button type="submit" variant="quiet">{t("findMeStill.openBooking")}</Button></div>
              </form>
            )}
          </CardBody>
        </Card>
      )}
    </div>
  );
}
