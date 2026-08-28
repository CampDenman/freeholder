// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// One private gallery (C8.03). Forms and links only.
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { Button, Card, CardBody, CardHeader } from "@/ui/primitives";
import { listAssets } from "@/core/media/service";
import {
  getGallery,
  listGalleryAccess,
  listGalleryGuests,
  listGallerySelections,
} from "@/modules/galleries/service";
import { getT } from "../../../../i18n";
import { requireStaffActor } from "../../guard";
import { domainOrNull } from "../../../read-helpers";
import { GALLERY_INVITE_COOKIE } from "@/modules/galleries/cookies";
import {
  addGalleryItemAction,
  inviteGalleryGuestAction,
  removeGalleryItemAction,
  revokeGalleryGuestAction,
  updateGalleryAction,
} from "../../../gallery-actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * `datetime-local` is local wall-clock, and the action parses what comes back
 * the same way. Rendering UTC into it moves the expiry by the offset every
 * time the form is saved without being touched.
 */
function localInput(value: Date | null): string {
  if (!value) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}T${pad(value.getHours())}:${pad(value.getMinutes())}`;
}

export default async function GalleryEditorPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string; error?: string; invited?: string }>;
}) {
  const { id } = await params;
  const actor = await requireStaffActor("galleries");
  const [t, gallery, guests, log, selections, library, query, jar] = await Promise.all([
    getT(),
    domainOrNull(getGallery.call({ id }, actor)),
    domainOrNull(listGalleryGuests.call({ galleryId: id }, actor)),
    domainOrNull(listGalleryAccess.call({ galleryId: id }, actor)),
    domainOrNull(listGallerySelections.call({ galleryId: id }, actor)),
    domainOrNull(listAssets.call({ limit: 100 }, actor)),
    searchParams,
    cookies(),
  ]);
  if (!gallery) notFound();

  const publicHref = `/g/${gallery.slug}`;
  const expiresValue = localInput(gallery.expiresAt ? new Date(gallery.expiresAt) : null);
  // Set by the invite action and short-lived. The raw token is gone after
  // that request, so this is the owner's one chance to copy the link.
  const inviteLink = query.invited ? jar.get(GALLERY_INVITE_COOKIE)?.value : undefined;

  return (
    <div className="grid gap-6">
      <div>
        <p className="text-sm">
          <a href="/admin/galleries" className="underline">
            {t("galleries.title")}
          </a>
        </p>
        <h1 className="text-xl font-bold tracking-tight">{gallery.title}</h1>
        <p className="mt-1 text-sm text-ink-muted">
          {t("galleries.link")}:{" "}
          <a href={publicHref} className="underline">
            {publicHref}
          </a>
        </p>
      </div>

      {query.saved ? (
        <p className="rounded-md border border-success bg-success-soft px-3 py-2 text-sm text-success">
          {t("galleries.saved")}
        </p>
      ) : null}
      {inviteLink ? (
        <div className="grid gap-2 rounded-md border border-success bg-success-soft px-3 py-2 text-sm text-success">
          <p>{t("galleries.invited")}</p>
          <label className="grid gap-1">
            <span>{t("galleries.guestLink")}</span>
            <input
              readOnly
              value={inviteLink}
              className="rounded-md border border-rule bg-field px-2 py-1 font-mono text-xs text-ink"
            />
          </label>
        </div>
      ) : null}
      {query.error ? (
        <p className="rounded-md border border-danger bg-danger-soft px-3 py-2 text-sm text-danger">
          {query.error.includes(" ") ? query.error : t("galleries.failed")}
        </p>
      ) : null}

      <Card>
        <CardHeader title={t("galleries.action.save")} />
        <CardBody>
          <form action={updateGalleryAction} className="grid gap-3 sm:grid-cols-2">
            <input type="hidden" name="id" value={gallery.id} />
            <label className="grid gap-1 text-sm">
              <span className="text-ink-muted">{t("galleries.field.title")}</span>
              <input
                name="title"
                defaultValue={gallery.title}
                className="rounded-md border border-rule bg-field px-2 py-1 text-sm"
              />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="text-ink-muted">{t("galleries.field.access")}</span>
              <select
                name="access"
                defaultValue={gallery.access}
                className="rounded-md border border-rule bg-field px-2 py-1 text-sm"
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
            <label className="grid gap-1 text-sm">
              <span className="text-ink-muted">{t("galleries.field.expires")}</span>
              <input
                type="datetime-local"
                name="expiresAt"
                defaultValue={expiresValue}
                className="rounded-md border border-rule bg-field px-2 py-1 text-sm"
              />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="text-ink-muted">{t("galleries.field.downloadPolicy")}</span>
              <select
                name="downloadPolicy"
                defaultValue={gallery.downloadPolicy}
                className="rounded-md border border-rule bg-field px-2 py-1 text-sm"
              >
                <option value="none">{t("galleries.download.none")}</option>
                <option value="web_res">{t("galleries.download.web_res")}</option>
                <option value="full_res">{t("galleries.download.full_res")}</option>
                <option value="limit_n">{t("galleries.download.limit_n")}</option>
              </select>
            </label>
            <label className="grid gap-1 text-sm">
              <span className="text-ink-muted">{t("galleries.field.downloadLimit")}</span>
              <input
                type="number"
                min={1}
                name="downloadLimit"
                defaultValue={gallery.downloadLimit ?? ""}
                className="rounded-md border border-rule bg-field px-2 py-1 text-sm"
              />
            </label>
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input type="checkbox" name="watermark" defaultChecked={gallery.watermark} />
              {t("galleries.field.watermark")}
            </label>
            <div>
              <Button type="submit">{t("galleries.action.save")}</Button>
            </div>
          </form>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("galleries.items")} />
        <CardBody>
          {gallery.items.length === 0 ? (
            <p className="text-sm text-ink-muted">{t("galleries.items.empty")}</p>
          ) : (
            <ul className="grid list-none gap-2 p-0">
              {gallery.items.map((item) => (
                <li
                  key={item.id}
                  className="flex flex-wrap items-center gap-3 rounded-md border border-rule p-3 text-sm"
                >
                  <span>{item.filename ?? item.assetId}</span>
                  <form action={removeGalleryItemAction}>
                    <input type="hidden" name="galleryId" value={gallery.id} />
                    <input type="hidden" name="id" value={item.id} />
                    <Button type="submit" variant="quiet">
                      {t("galleries.action.remove")}
                    </Button>
                  </form>
                </li>
              ))}
            </ul>
          )}
          <form action={addGalleryItemAction} className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="galleryId" value={gallery.id} />
            <label className="grid gap-1 text-sm">
              <span className="text-ink-muted">{t("galleries.field.asset")}</span>
              <select
                name="assetId"
                required
                className="rounded-md border border-rule bg-field px-2 py-1 text-sm"
              >
                {(library?.rows ?? []).map((asset) => (
                  <option key={asset.id} value={asset.id}>
                    {asset.filename}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="canDownload" defaultChecked />
              {t("galleries.field.canDownload")}
            </label>
            <Button type="submit">{t("galleries.action.save")}</Button>
          </form>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("galleries.guests")} />
        <CardBody>
          {!guests || guests.length === 0 ? (
            <p className="text-sm text-ink-muted">{t("galleries.guests.empty")}</p>
          ) : (
            <ul className="grid list-none gap-2 p-0">
              {guests.map((guest) => (
                <li
                  key={guest.id}
                  className="flex flex-wrap items-center gap-3 rounded-md border border-rule p-3 text-sm"
                >
                  <span>
                    {guest.contactName ?? guest.contactEmail} · {t(`galleries.role.${guest.role}`)}
                  </span>
                  {guest.revokedAt ? null : (
                    <form action={revokeGalleryGuestAction}>
                      <input type="hidden" name="galleryId" value={gallery.id} />
                      <input type="hidden" name="id" value={guest.id} />
                      <Button type="submit" variant="quiet">
                        {t("galleries.action.revoke")}
                      </Button>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          )}
          <form action={inviteGalleryGuestAction} className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="galleryId" value={gallery.id} />
            <label className="grid gap-1 text-sm">
              <span className="text-ink-muted">{t("galleries.field.email")}</span>
              <input
                type="email"
                name="email"
                required
                className="rounded-md border border-rule bg-field px-2 py-1 text-sm"
              />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="text-ink-muted">{t("galleries.field.role")}</span>
              <select
                name="role"
                defaultValue="partner"
                className="rounded-md border border-rule bg-field px-2 py-1 text-sm"
              >
                <option value="partner">{t("galleries.role.partner")}</option>
                <option value="client">{t("galleries.role.client")}</option>
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="canDownload" />
              {t("galleries.field.canDownload")}
            </label>
            <Button type="submit">{t("galleries.action.invite")}</Button>
          </form>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("galleries.selections")} />
        <CardBody>
          {!selections || selections.length === 0 ? (
            <p className="text-sm text-ink-muted">{t("galleries.selections.empty")}</p>
          ) : (
            <ul className="grid list-none gap-2 p-0">
              {selections.map((selection) => (
                <li
                  key={selection.id}
                  className="flex flex-wrap items-center gap-3 rounded-md border border-rule p-3 text-sm"
                >
                  <span className="font-medium">
                    {t(`galleries.proof.${selection.kind}`)}
                  </span>
                  <span>{selection.filename ?? selection.assetId}</span>
                  <span className="text-ink-muted">
                    {selection.contactName ?? t("galleries.selections.empty")}
                  </span>
                  {selection.comment ? (
                    <span className="text-ink-muted">“{selection.comment}”</span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("galleries.audit")} />
        <CardBody>
          {!log || log.length === 0 ? (
            <p className="text-sm text-ink-muted">{t("galleries.audit.empty")}</p>
          ) : (
            <ul className="grid list-none gap-2 p-0">
              {log.map((entry) => (
                <li key={entry.id} className="text-sm text-ink-muted">
                  {t(`galleries.audit.${entry.action}`)} · {entry.at.toISOString()}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
