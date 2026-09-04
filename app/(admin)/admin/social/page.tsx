// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Social connection hub (C9.24, MASTER.md §33).
import type { Metadata } from "next";
import { ShareNetwork, WarningCircle } from "@phosphor-icons/react/dist/ssr";
import {
  Button,
  Callout,
  Card,
  CardBody,
  CardHeader,
  Field,
  Pill,
  Select,
} from "@/ui/primitives";
import { listLocations } from "@/core/locations/service";
import {
  SOCIAL_APPROVAL_POLICIES,
  SOCIAL_ASSIGNMENTS,
} from "@/modules/social/contract";
import {
  attributionReport,
  interactionList,
  networks,
  packageList,
  profiles,
  publicationCalendar,
  staffMembers,
  variantList,
} from "@/modules/social/service";
import { getT } from "../../../i18n";
import { requireStaffActor } from "../guard";
import { domainOrNull } from "../../read-helpers";
import {
  assignSocialAction,
  beginSocialOAuthAction,
  disconnectSocialAction,
  draftSocialAction,
  healthSocialAction,
  ingestSocialAction,
  reviewSocialAction,
  composeSocialAction,
  reviewVariantAction,
  scheduleSocialAction,
  setSocialPolicyAction,
  syncGbpAction,
} from "../../social-actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

const HEALTH_TONES = {
  ok: "success",
  expiring: "warning",
  expired: "danger",
  error: "danger",
} as const;

const STATUS_TONES = {
  pending_review: "warning",
  active: "success",
  needs_reconnect: "warning",
  revoked: "neutral",
} as const;

export default async function SocialPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string; social?: string }>;
}) {
  const actor = await requireStaffActor("social", "manage");
  const [t, known, connected, staff, places, packs, threads, variants, calendar, attributed, query] = await Promise.all([
    getT(),
    domainOrNull(networks.call({}, actor)),
    domainOrNull(profiles.call({}, actor)),
    domainOrNull(staffMembers.call({}, actor)),
    domainOrNull(listLocations.call({ includeHidden: true }, actor)),
    domainOrNull(packageList.call({}, actor)),
    domainOrNull(interactionList.call({}, actor)),
    domainOrNull(variantList.call({}, actor)),
    domainOrNull(publicationCalendar.call({}, actor)),
    domainOrNull(attributionReport.call({ days: 30 }, actor)),
    searchParams,
  ]);

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight">
          <ShareNetwork size={22} weight="duotone" className="text-accent" />
          {t("social.title")}
        </h1>
        <p className="mt-1 max-w-prose text-sm text-ink-muted">{t("social.intro")}</p>
      </div>

      {query.saved ? (
        <p className="rounded-md border border-success bg-success-soft px-3 py-2 text-sm text-success">
          {t("social.saved")}
        </p>
      ) : null}
      {query.social === "connected" ? (
        <p className="rounded-md border border-success bg-success-soft px-3 py-2 text-sm text-success">
          {t("social.connected")}
        </p>
      ) : null}
      {query.error ? (
        <p className="rounded-md border border-danger bg-danger-soft px-3 py-2 text-sm text-danger">
          {query.error}
        </p>
      ) : null}

      <Card>
        <CardHeader title={t("social.networks")} />
        <CardBody>
          <p className="max-w-prose text-sm text-ink-muted">{t("social.networksHint")}</p>
          <ul className="mt-3 grid list-none gap-2 p-0">
            {(known ?? []).map((network) => (
              <li
                key={network.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-rule p-3 text-sm"
              >
                <span className="grid gap-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{network.label}</span>
                    <Pill tone={network.available ? "success" : "neutral"}>
                      {network.available ? t("social.ready") : t("social.notReady")}
                    </Pill>
                  </span>
                  <span className="text-xs text-ink-muted">{network.message}</span>
                </span>
                {network.available ? (
                  <form action={beginSocialOAuthAction}>
                    <input type="hidden" name="provider" value={network.id} />
                    <Button type="submit">{t("social.action.connect")}</Button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("social.profiles")} />
        <CardBody>
          <p className="max-w-prose text-sm text-ink-muted">{t("social.profilesHint")}</p>
          {(connected ?? []).length === 0 ? (
            <p className="mt-2 text-sm text-ink-muted">{t("social.profilesEmpty")}</p>
          ) : (
            <ul className="mt-3 grid list-none gap-4 p-0">
              {(connected ?? []).map((profile) => (
                <li key={profile.id} className="grid gap-3 rounded-md border border-rule p-3 text-sm">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{profile.displayName}</span>
                    {profile.handle ? (
                      <span className="text-ink-muted">@{profile.handle}</span>
                    ) : null}
                    <Pill tone={STATUS_TONES[profile.status]}>
                      {t(`social.status.${profile.status}`)}
                    </Pill>
                    {profile.lastHealthStatus ? (
                      <Pill tone={HEALTH_TONES[profile.lastHealthStatus]}>
                        {t(`social.health.${profile.lastHealthStatus}`)}
                      </Pill>
                    ) : null}
                    <span className="text-xs text-ink-muted">{profile.provider}</span>
                  </span>
                  {profile.lastError ? (
                    <Callout tone="warning" icon={<WarningCircle size={18} weight="duotone" />}>
                      {profile.lastError}
                    </Callout>
                  ) : null}

                  {profile.status === "pending_review" ? (
                    <div className="flex flex-wrap gap-2">
                      <form action={reviewSocialAction}>
                        <input type="hidden" name="id" value={profile.id} />
                        <input type="hidden" name="approved" value="1" />
                        <Button type="submit">{t("social.action.approve")}</Button>
                      </form>
                      <form action={reviewSocialAction}>
                        <input type="hidden" name="id" value={profile.id} />
                        <input type="hidden" name="approved" value="0" />
                        <Button type="submit" variant="quiet">
                          {t("social.action.reject")}
                        </Button>
                      </form>
                    </div>
                  ) : null}

                  <form action={assignSocialAction} className="grid gap-3 md:grid-cols-2">
                    <input type="hidden" name="id" value={profile.id} />
                    <Field label={t("social.field.assignedTo")} htmlFor={`assign-${profile.id}`}>
                      <Select
                        id={`assign-${profile.id}`}
                        name="assignedTo"
                        defaultValue={profile.assignedTo}
                      >
                        {SOCIAL_ASSIGNMENTS.map((value) => (
                          <option key={value} value={value}>
                            {t(`social.assignment.${value}`)}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label={t("social.field.assignee")} htmlFor={`person-${profile.id}`}>
                      <Select
                        id={`person-${profile.id}`}
                        name="assigneeUserId"
                        defaultValue={profile.assigneeUserId ?? ""}
                      >
                        <option value="">{t("social.field.assigneeNone")}</option>
                        {(staff ?? []).map((person) => (
                          <option key={person.id} value={person.id}>
                            {person.email}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    {(places ?? []).length > 0 ? (
                      <fieldset className="grid gap-1 md:col-span-2">
                        <legend className="text-sm font-medium">{t("social.field.locations")}</legend>
                        {(places ?? []).map((place) => (
                          <label key={place.id} className="flex items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              name="locationIds"
                              value={place.id}
                              defaultChecked={profile.locationIds.includes(place.id)}
                            />
                            {place.name}
                          </label>
                        ))}
                      </fieldset>
                    ) : null}
                    <div>
                      <Button type="submit">{t("social.action.assign")}</Button>
                    </div>
                  </form>

                  <form action={setSocialPolicyAction} className="grid gap-3 md:grid-cols-2">
                    <input type="hidden" name="id" value={profile.id} />
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" name="allowRead" value="1" defaultChecked={profile.allowRead} />
                      {t("social.field.read")}
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        name="allowRespond"
                        value="1"
                        defaultChecked={profile.allowRespond}
                      />
                      {t("social.field.respond")}
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        name="allowPublish"
                        value="1"
                        defaultChecked={profile.allowPublish}
                      />
                      {t("social.field.publish")}
                    </label>
                    <Field label={t("social.field.approval")} htmlFor={`approval-${profile.id}`}>
                      <Select
                        id={`approval-${profile.id}`}
                        name="approvalPolicy"
                        defaultValue={profile.approvalPolicy}
                      >
                        {SOCIAL_APPROVAL_POLICIES.map((value) => (
                          <option key={value} value={value}>
                            {t(`social.approval.${value}`)}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <div>
                      <Button type="submit">{t("social.action.savePolicy")}</Button>
                    </div>
                  </form>

                  <div className="flex flex-wrap gap-2">
                    {profile.status === "active" && profile.allowRead ? (
                      <form action={ingestSocialAction}>
                        <input type="hidden" name="id" value={profile.id} />
                        <Button type="submit" variant="quiet">
                          {t("social.action.ingest")}
                        </Button>
                      </form>
                    ) : null}
                    {profile.status === "active" && profile.provider === "google_business" ? (
                      <form action={syncGbpAction}>
                        <input type="hidden" name="id" value={profile.id} />
                        <Button type="submit" variant="quiet">
                          {t("social.action.syncGbp")}
                        </Button>
                      </form>
                    ) : null}
                    <form action={healthSocialAction}>
                      <input type="hidden" name="id" value={profile.id} />
                      <Button type="submit" variant="quiet">
                        {t("social.action.health")}
                      </Button>
                    </form>
                    <form action={disconnectSocialAction}>
                      <input type="hidden" name="id" value={profile.id} />
                      <Button type="submit" variant="quiet">
                        {t("social.action.disconnect")}
                      </Button>
                    </form>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("social.packages")} />
        <CardBody>
          <p className="max-w-prose text-sm text-ink-muted">{t("social.packagesHint")}</p>
          {(packs ?? []).length === 0 ? (
            <p className="mt-2 text-sm text-ink-muted">{t("social.packagesEmpty")}</p>
          ) : (
            <ul className="mt-3 grid list-none gap-3 p-0">
              {(packs ?? []).map((entry) => (
                <li key={entry.id} className="grid gap-2 rounded-md border border-rule p-3 text-sm">
                  <span className="flex flex-wrap items-center gap-2">
                    <Pill tone={entry.sourceKind === "draft" ? "warning" : "success"}>
                      {t(`social.sourceKind.${entry.sourceKind}`)}
                    </Pill>
                    <span className="text-xs text-ink-muted">{entry.rights}</span>
                    {entry.sourceRef ? (
                      <span className="font-mono text-xs text-ink-muted">{entry.sourceRef}</span>
                    ) : null}
                  </span>
                  <p className="text-ink">{entry.body || t("social.packagesNoCaption")}</p>
                  <form action={draftSocialAction}>
                    <input type="hidden" name="id" value={entry.id} />
                    <Button type="submit" variant="quiet">
                      {t("social.action.draft")}
                    </Button>
                  </form>
                </li>
              ))}
            </ul>
          )}
          {(threads ?? []).length > 0 ? (
            <div className="mt-4 grid gap-2">
              <h2 className="text-sm font-medium">{t("social.threads")}</h2>
              <ul className="grid list-none gap-2 p-0">
                {(threads ?? []).map((item) => (
                  <li key={item.id} className="rounded-md border border-rule p-3 text-sm">
                    <span className="text-xs text-ink-muted">
                      {item.authorHandle}
                      {item.contactId ? ` · ${t("social.threadOnSpine")}` : ` · ${t("social.threadOffSpine")}`}
                    </span>
                    <p className="text-ink">{item.body}</p>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("social.compose")} />
        <CardBody>
          <p className="max-w-prose text-sm text-ink-muted">{t("social.composeHint")}</p>
          <form action={composeSocialAction} className="mt-3 grid gap-3">
            <label className="grid gap-1 text-sm">
              <span className="font-medium">{t("social.field.caption")}</span>
              <textarea
                name="body"
                rows={4}
                maxLength={8000}
                className="w-full rounded-md border border-rule bg-field px-3 py-2 text-sm"
              />
            </label>
            <fieldset className="grid gap-1">
              <legend className="text-sm font-medium">{t("social.field.profiles")}</legend>
              {(connected ?? [])
                .filter((profile) => profile.status === "active")
                .map((profile) => (
                  <label key={profile.id} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="profileIds" value={profile.id} />
                    {profile.displayName}
                  </label>
                ))}
            </fieldset>
            <div>
              <Button type="submit">{t("social.action.compose")}</Button>
            </div>
          </form>
          {(variants ?? []).length > 0 ? (
            <ul className="mt-4 grid list-none gap-2 p-0">
              {(variants ?? []).map((variant) => (
                <li key={variant.id} className="grid gap-2 rounded-md border border-rule p-3 text-sm">
                  <span className="flex flex-wrap items-center gap-2">
                    <Pill
                      tone={
                        variant.status === "approved"
                          ? "success"
                          : variant.status === "rejected"
                            ? "danger"
                            : "warning"
                      }
                    >
                      {t(`social.variantStatus.${variant.status}`)}
                    </Pill>
                    <span className="text-xs text-ink-muted">{variant.aspectRatio}</span>
                    {variant.generated ? (
                      <span className="text-xs text-ink-muted">{t("social.generated")}</span>
                    ) : null}
                  </span>
                  <p>{variant.caption}</p>
                  {variant.status === "pending_review" || variant.status === "draft" ? (
                    <div className="flex flex-wrap gap-2">
                      <form action={reviewVariantAction}>
                        <input type="hidden" name="id" value={variant.id} />
                        <input type="hidden" name="approved" value="1" />
                        <Button type="submit">{t("social.action.approve")}</Button>
                      </form>
                      <form action={reviewVariantAction}>
                        <input type="hidden" name="id" value={variant.id} />
                        <input type="hidden" name="approved" value="0" />
                        <Button type="submit" variant="quiet">
                          {t("social.action.reject")}
                        </Button>
                      </form>
                    </div>
                  ) : null}
                  {variant.status === "approved" ? (
                    <form action={scheduleSocialAction}>
                      <input type="hidden" name="variantIds" value={variant.id} />
                      <Button type="submit">{t("social.action.publish")}</Button>
                    </form>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("social.calendar")} />
        <CardBody>
          <p className="max-w-prose text-sm text-ink-muted">{t("social.calendarHint")}</p>
          {(calendar ?? []).length === 0 ? (
            <p className="mt-2 text-sm text-ink-muted">{t("social.calendarEmpty")}</p>
          ) : (
            <ul className="mt-3 grid list-none gap-2 p-0">
              {(calendar ?? []).map((entry) => (
                <li key={entry.id} className="flex flex-wrap items-center gap-2 rounded-md border border-rule p-3 text-sm">
                  <Pill tone={entry.status === "published" ? "success" : entry.status === "failed" ? "danger" : "warning"}>
                    {t(`social.publicationStatus.${entry.status}`)}
                  </Pill>
                  <span className="text-xs text-ink-muted">{entry.provider}</span>
                  {entry.providerRef ? (
                    <span className="font-mono text-xs text-ink-muted">{entry.providerRef}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("social.attribution")} />
        <CardBody>
          <p className="max-w-prose text-sm text-ink-muted">{t("social.attributionHint")}</p>
          {(attributed ?? []).length === 0 ? (
            <p className="mt-2 text-sm text-ink-muted">{t("social.attributionEmpty")}</p>
          ) : (
            <ul className="mt-3 grid list-none gap-2 p-0">
              {(attributed ?? []).map((row) => (
                <li
                  key={`${row.source}:${row.campaign ?? ""}`}
                  className="flex flex-wrap items-center gap-2 rounded-md border border-rule p-3 text-sm"
                >
                  <span className="font-medium">{row.source}</span>
                  <span className="text-xs text-ink-muted">
                    {t("social.attributionVisitors")}: {row.visitors}
                  </span>
                  <span className="text-xs text-ink-muted">
                    {t("social.attributionContacts")}: {row.contacts}
                  </span>
                  <span className="text-xs text-ink-muted">
                    {t("social.attributionRevenue")}: {row.revenueMinor}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
