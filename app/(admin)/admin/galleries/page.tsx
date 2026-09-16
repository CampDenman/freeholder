// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Private client galleries (C8.03, MASTER.md §4.5).
import type { Metadata } from "next";
import { Button, Card, CardBody, CardHeader, Pill, type Tone } from "@/ui/primitives";
import { listContacts } from "@/core/contacts/service";
import { listGalleries } from "@/modules/galleries/service";
import { getT } from "../../../i18n";
import { requireStaffActor } from "../guard";
import { domainOrNull } from "../../read-helpers";
import { createGalleryAction } from "../../gallery-actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

const ACCESS_TONES: Record<string, Tone> = {
  pin: "accent",
  password: "accent",
  login: "success",
};

export default async function GalleriesPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const actor = await requireStaffActor("galleries");
  const [t, rows, people, query] = await Promise.all([
    getT(),
    domainOrNull(listGalleries.call({ limit: 100 }, actor)),
    domainOrNull(listContacts.call({ limit: 100 }, actor)),
    searchParams,
  ]);

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight">{t("galleries.title")}</h1>
        <p className="mt-1 max-w-prose text-sm text-ink-muted">{t("galleries.intro")}</p>
      </div>

      {query.saved ? (
        <p className="rounded-md border border-success bg-success-soft px-3 py-2 text-sm text-success">
          {t("galleries.saved")}
        </p>
      ) : null}
      {query.error ? (
        <p className="rounded-md border border-danger bg-danger-soft px-3 py-2 text-sm text-danger">
          {query.error.includes(" ") ? query.error : t("galleries.failed")}
        </p>
      ) : null}

      <Card>
        <CardHeader title={t("galleries.title")} />
        <CardBody>
          {rows === null ? (
            <p className="text-sm text-danger">{t("galleries.unavailable")}</p>
          ) : rows.length === 0 ? (
            <p className="max-w-prose text-sm text-ink-muted">{t("galleries.empty")}</p>
          ) : (
            <ul className="grid list-none gap-2 p-0">
              {rows.map((gallery) => (
                <li
                  key={gallery.id}
                  className="flex flex-wrap items-center gap-3 rounded-md border border-rule p-3 text-sm"
                >
                  <a href={`/admin/galleries/${gallery.id}`} className="font-medium underline">
                    {gallery.title}
                  </a>
                  <Pill tone={ACCESS_TONES[gallery.access] ?? "neutral"}>
                    {t(`galleries.access.${gallery.access}`)}
                  </Pill>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("galleries.start")} />
        <CardBody>
          <form action={createGalleryAction} className="flex flex-wrap items-end gap-3">
            <label className="grid gap-1 text-sm">
              <span className="text-ink-muted">{t("galleries.field.title")}</span>
              <input
                name="title"
                required
                className="rounded-md border border-rule bg-field px-2 py-1 text-sm"
              />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="text-ink-muted">{t("galleries.field.client")}</span>
              <select
                name="contactId"
                required
                className="rounded-md border border-rule bg-field px-2 py-1 text-sm"
              >
                <option value="">{t("galleries.field.client")}</option>
                {(people?.rows ?? []).map((contact) => (
                  <option key={contact.id} value={contact.id}>
                    {contact.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-sm">
              <span className="text-ink-muted">{t("galleries.field.access")}</span>
              <select
                name="access"
                className="rounded-md border border-rule bg-field px-2 py-1 text-sm"
                defaultValue="pin"
              >
                <option value="pin">{t("galleries.access.pin")}</option>
                <option value="password">{t("galleries.access.password")}</option>
                <option value="login">{t("galleries.access.login")}</option>
              </select>
            </label>
            <label className="grid gap-1 text-sm">
              <span className="text-ink-muted">{t("galleries.field.secret")}</span>
              <input
                name="secret"
                className="rounded-md border border-rule bg-field px-2 py-1 text-sm"
              />
            </label>
            <Button type="submit">{t("galleries.action.create")}</Button>
          </form>
        </CardBody>
      </Card>
    </div>
  );
}
