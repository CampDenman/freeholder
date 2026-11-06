// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Link in bio: the one link for every social profile (C9.39).
//
// This screen is a convenience over a page, not a second editor. The page is
// an ordinary CMS page with a `linkInBio` block, so the visual editor edits
// the same links inline; this screen adds what a list of links needs and a
// canvas does not have room for — pickers for the site's own products,
// bookings and events, scheduling in the business's time zone, the reason a
// link is not showing, and the clicks each one has had.
import type { Metadata } from "next";
import { Button, Callout, Card, CardBody, CardHeader, Field, Input, Pill, Select } from "@/ui/primitives";
import type { Tone } from "@/ui/primitives";
import { listAssets } from "@/core/media/service";
import { hasModuleAccess } from "@/core/service";
import { LINK_KINDS, LINK_STYLES, SOCIAL_NETWORKS, type LinkKind, type LinkState } from "@/modules/linkinbio/links";
import { page as linkInBioPage, report, targets } from "@/modules/linkinbio/service";
import { getT } from "../../../i18n";
import { requireStaffActor } from "../guard";
import { domainOrNull } from "../../read-helpers";
import {
  addBioLinkAction,
  moveBioLinkAction,
  removeBioLinkAction,
  saveBioProfileAction,
  setupLinkInBioAction,
  toggleBioLinkAction,
  updateBioLinkAction,
} from "../../linkinbio-actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

const STATE_TONES: Record<LinkState, Tone> = {
  live: "success",
  hidden: "neutral",
  scheduled: "accent",
  expired: "neutral",
  invalidSchedule: "danger",
  needsLabel: "warning",
  needsTarget: "warning",
  unavailable: "warning",
};

/** Pending reasons the services can return, each with its own sentence. */
const PENDING = new Set(["notRequested", "draftPage", "unpublishedEdits", "awaitingApproval"]);

export default async function LinkInBioPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string; pending?: string }>;
}) {
  const actor = await requireStaffActor("linkinbio");
  const canManage = hasModuleAccess(actor, "linkinbio", "manage");
  const [t, query, view, stats, choices, media] = await Promise.all([
    getT(),
    searchParams,
    domainOrNull(linkInBioPage.call({}, actor)),
    domainOrNull(report.call({ days: 30 }, actor)),
    domainOrNull(targets.call({}, actor)),
    domainOrNull(listAssets.call({ kind: "image", limit: 100 }, actor)),
  ]);
  const clicks = new Map((stats?.links ?? []).map((row) => [row.id, row]));
  const options = choices ?? [];
  const smartKinds = LINK_KINDS.filter((kind) => kind !== "url");
  const order = (view?.links ?? []).map((link) => link.id).join(",");

  const kindSelect = (id: string, value: LinkKind) => (
    <Field label={t("linkinbio.admin.kind")} htmlFor={id}>
      <Select id={id} name="kind" defaultValue={value}>
        {LINK_KINDS.map((kind) => (
          <option key={kind} value={kind}>
            {t(`linkinbio.kind.${kind}`)}
          </option>
        ))}
      </Select>
    </Field>
  );

  // One picker per smart kind; the action reads the one matching the chosen
  // kind. Native selects, so it works without script and on a phone.
  const targetPickers = (prefix: string, current?: { kind: LinkKind; target: string }) => (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label={t("linkinbio.admin.url")} htmlFor={`${prefix}-url`} hint={t("linkinbio.admin.urlHint")}>
        <Input
          id={`${prefix}-url`}
          name="url"
          type="text"
          inputMode="url"
          defaultValue={current?.kind === "url" ? current.target : ""}
          placeholder={t("linkinbio.admin.urlPlaceholder")}
        />
      </Field>
      {smartKinds.map((kind) => {
        const listed = options.filter((option) => option.kind === kind);
        const keep =
          current && current.kind === kind && !listed.some((option) => option.target === current.target)
            ? [{ kind, target: current.target, title: current.target }]
            : [];
        return (
          <Field key={kind} label={t(`linkinbio.kind.${kind}`)} htmlFor={`${prefix}-${kind}`}>
            <Select
              id={`${prefix}-${kind}`}
              name={`target-${kind}`}
              defaultValue={current?.kind === kind ? current.target : ""}
            >
              <option value="">{t("linkinbio.admin.choose")}</option>
              {[...keep, ...listed].map((option) => (
                <option key={`${kind}:${option.target}`} value={option.target}>
                  {option.title}
                </option>
              ))}
            </Select>
          </Field>
        );
      })}
    </div>
  );

  const schedule = (prefix: string, values?: { startsAt: string; endsAt: string }) => (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label={t("linkinbio.admin.startsAt")} htmlFor={`${prefix}-starts`} hint={view ? t("linkinbio.admin.zone", { zone: view.timezone }) : undefined}>
        <Input id={`${prefix}-starts`} name="startsAt" type="datetime-local" defaultValue={values?.startsAt.slice(0, 16) ?? ""} />
      </Field>
      <Field label={t("linkinbio.admin.endsAt")} htmlFor={`${prefix}-ends`}>
        <Input id={`${prefix}-ends`} name="endsAt" type="datetime-local" defaultValue={values?.endsAt.slice(0, 16) ?? ""} />
      </Field>
    </div>
  );

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight">{t("linkinbio.title")}</h1>
        <p className="mt-1 max-w-prose text-sm text-ink-muted">{t("linkinbio.admin.intro")}</p>
      </div>

      {query.saved ? (
        <p role="status" className="rounded-md border border-success bg-success-soft px-3 py-2 text-sm text-success">
          {query.pending && PENDING.has(query.pending)
            ? t(`linkinbio.pending.${query.pending}`)
            : t("linkinbio.admin.saved")}
        </p>
      ) : null}
      {query.error ? <Callout tone="danger">{query.error}</Callout> : null}

      {!view ? (
        <Card>
          <CardHeader title={t("linkinbio.admin.setupTitle")} />
          <CardBody>
            <p className="mb-4 max-w-prose text-sm text-ink-muted">{t("linkinbio.admin.setupIntro")}</p>
            {canManage ? (
              <form action={setupLinkInBioAction} className="grid max-w-md gap-3">
                <Field label={t("linkinbio.admin.slug")} htmlFor="lib-slug" hint={t("linkinbio.admin.slugHint")}>
                  <Input id="lib-slug" name="slug" defaultValue="links" required />
                </Field>
                <label className="flex items-center gap-2 text-sm text-ink">
                  <input type="checkbox" name="publish" />
                  {t("linkinbio.admin.publishNow")}
                </label>
                <div>
                  <Button type="submit">{t("linkinbio.admin.create")}</Button>
                </div>
              </form>
            ) : null}
          </CardBody>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader title={view.page.title} />
            <CardBody>
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <Pill tone={view.page.status === "published" ? "success" : "neutral"}>
                  {t(view.page.status === "published" ? "linkinbio.admin.live" : "linkinbio.admin.draft")}
                </Pill>
                <a href={view.page.publicUrl} className="font-mono text-xs text-ink underline">
                  {view.page.publicUrl}
                </a>
                <a href={view.page.editorPath} className="text-ink-muted underline hover:text-ink">
                  {t("linkinbio.admin.openEditor")}
                </a>
              </div>
              {view.page.unpublishedEdits ? (
                <div className="mt-3">
                  <Callout tone="warning">{t("linkinbio.pending.unpublishedEdits")}</Callout>
                </div>
              ) : null}
              <p className="mt-3 max-w-prose text-xs text-ink-muted">
                {t("linkinbio.admin.clicksNote", { total: stats?.totalClicks ?? 0 })}
              </p>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title={t("linkinbio.admin.links")} />
            <CardBody>
              {view.links.length === 0 ? (
                <p className="text-sm text-ink-muted">{t("linkinbio.admin.empty")}</p>
              ) : (
                <ol className="grid list-none gap-3 p-0">
                  {view.links.map((link, index) => {
                    const numbers = clicks.get(link.id);
                    return (
                      <li key={link.id} className="grid gap-2 rounded-md border border-rule p-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-ink">{link.label || t("linkinbio.admin.untitled")}</span>
                          <Pill tone={STATE_TONES[link.state]}>{t(`linkinbio.state.${link.state}`)}</Pill>
                          <span className="text-xs text-ink-muted">{t(`linkinbio.kind.${link.kind}`)}</span>
                          <span className="ms-auto text-xs text-ink-muted">
                            {t("linkinbio.admin.clicks", { clicks: numbers?.clicks ?? 0, visitors: numbers?.visitors ?? 0 })}
                          </span>
                        </div>
                        {link.destination ? (
                          <p className="break-all font-mono text-xs text-ink-muted">{link.destination}</p>
                        ) : null}
                        {link.startsAt || link.endsAt ? (
                          <p className="text-xs text-ink-muted">
                            {t("linkinbio.admin.window", { from: link.startsAt || "—", until: link.endsAt || "—" })}
                          </p>
                        ) : null}
                        {canManage ? (
                          <div className="flex flex-wrap items-center gap-2">
                            <form action={moveBioLinkAction}>
                              <input type="hidden" name="id" value={link.id} />
                              <input type="hidden" name="order" value={order} />
                              <input type="hidden" name="direction" value="up" />
                              <Button variant="quiet" type="submit" disabled={index === 0}>
                                {t("linkinbio.admin.up")}
                              </Button>
                            </form>
                            <form action={moveBioLinkAction}>
                              <input type="hidden" name="id" value={link.id} />
                              <input type="hidden" name="order" value={order} />
                              <input type="hidden" name="direction" value="down" />
                              <Button variant="quiet" type="submit" disabled={index === view.links.length - 1}>
                                {t("linkinbio.admin.down")}
                              </Button>
                            </form>
                            <form action={toggleBioLinkAction}>
                              <input type="hidden" name="id" value={link.id} />
                              <input type="hidden" name="hidden" value={link.hidden ? "0" : "1"} />
                              <Button variant="quiet" type="submit">
                                {t(link.hidden ? "linkinbio.admin.show" : "linkinbio.admin.hide")}
                              </Button>
                            </form>
                            <details className="w-full">
                              <summary className="cursor-pointer text-sm text-ink-muted underline">
                                {t("linkinbio.admin.edit")}
                              </summary>
                              <form action={updateBioLinkAction} className="mt-3 grid gap-3">
                                <input type="hidden" name="id" value={link.id} />
                                <Field label={t("linkinbio.admin.label")} htmlFor={`edit-${link.id}-label`}>
                                  <Input id={`edit-${link.id}-label`} name="label" defaultValue={link.label} required maxLength={120} />
                                </Field>
                                {kindSelect(`edit-${link.id}-kind`, link.kind)}
                                {targetPickers(`edit-${link.id}`, { kind: link.kind, target: link.target })}
                                {schedule(`edit-${link.id}`, link)}
                                <div>
                                  <Button type="submit">{t("linkinbio.admin.saveLink")}</Button>
                                </div>
                              </form>
                              <form action={removeBioLinkAction} className="mt-4 flex flex-wrap items-center gap-2">
                                <input type="hidden" name="id" value={link.id} />
                                <label className="flex items-center gap-1.5 text-xs text-ink-muted">
                                  <input type="checkbox" name="confirm" />
                                  {t("linkinbio.admin.confirmRemove")}
                                </label>
                                <Button variant="danger" type="submit">
                                  {t("linkinbio.admin.remove")}
                                </Button>
                              </form>
                            </details>
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                </ol>
              )}
            </CardBody>
          </Card>

          {canManage ? (
            <Card>
              <CardHeader title={t("linkinbio.admin.addTitle")} />
              <CardBody>
                <form action={addBioLinkAction} className="grid gap-3">
                  <Field label={t("linkinbio.admin.label")} htmlFor="add-label">
                    <Input id="add-label" name="label" required maxLength={120} />
                  </Field>
                  {kindSelect("add-kind", "url")}
                  <p className="text-xs text-ink-muted">{t("linkinbio.admin.kindHint")}</p>
                  {targetPickers("add")}
                  {schedule("add")}
                  <label className="flex items-center gap-2 text-sm text-ink">
                    <input type="checkbox" name="hidden" />
                    {t("linkinbio.admin.startHidden")}
                  </label>
                  <div>
                    <Button type="submit">{t("linkinbio.admin.add")}</Button>
                  </div>
                </form>
              </CardBody>
            </Card>
          ) : null}

          {canManage ? (
            <Card>
              <CardHeader title={t("linkinbio.admin.profileTitle")} />
              <CardBody>
                <form action={saveBioProfileAction} className="grid gap-3">
                  <Field label={t("linkinbio.admin.name")} htmlFor="profile-name" hint={t("linkinbio.admin.nameHint")}>
                    <Input id="profile-name" name="name" defaultValue={view.profile.name} maxLength={120} />
                  </Field>
                  <Field label={t("linkinbio.admin.bio")} htmlFor="profile-bio">
                    <textarea
                      id="profile-bio"
                      name="bio"
                      rows={3}
                      maxLength={600}
                      defaultValue={view.profile.bio}
                      className="w-full rounded-md border border-rule-strong bg-field px-3 py-2 text-base text-ink"
                    />
                  </Field>
                  <Field label={t("linkinbio.admin.avatar")} htmlFor="profile-avatar" hint={t("linkinbio.admin.avatarHint")}>
                    <Select id="profile-avatar" name="avatarAssetId" defaultValue={view.profile.avatarAssetId}>
                      <option value="">{t("linkinbio.admin.useLogo")}</option>
                      {(media?.rows ?? []).map((asset) => (
                        <option key={asset.id} value={asset.id}>
                          {asset.filename}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label={t("linkinbio.admin.style")} htmlFor="profile-style">
                    <Select id="profile-style" name="style" defaultValue={view.profile.style}>
                      {LINK_STYLES.map((style) => (
                        <option key={style} value={style}>
                          {t(`linkinbio.style.${style}`)}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <fieldset className="grid gap-2">
                    <legend className="text-sm font-medium text-ink">{t("linkinbio.admin.socials")}</legend>
                    {[...view.profile.socials, { network: "instagram" as const, url: "" }, { network: "tiktok" as const, url: "" }].map(
                      (item, index) => (
                        <div key={index} className="grid gap-2 sm:grid-cols-[12rem_1fr]">
                          <Select name="socialNetwork" defaultValue={item.network} aria-label={t("linkinbio.admin.network")}>
                            {SOCIAL_NETWORKS.map((network) => (
                              <option key={network} value={network}>
                                {t(`linkinbio.network.${network}`)}
                              </option>
                            ))}
                          </Select>
                          <Input name="socialUrl" defaultValue={item.url} aria-label={t("linkinbio.admin.profileUrl")} placeholder={t("linkinbio.admin.urlPlaceholder")} />
                        </div>
                      ),
                    )}
                    <p className="text-xs text-ink-muted">{t("linkinbio.admin.socialsHint")}</p>
                  </fieldset>
                  <div>
                    <Button type="submit">{t("linkinbio.admin.saveProfile")}</Button>
                  </div>
                </form>
              </CardBody>
            </Card>
          ) : null}
        </>
      )}
    </div>
  );
}
