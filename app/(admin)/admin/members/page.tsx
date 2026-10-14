// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.01 (MASTER.md §44.1): members of this site.
import type { Metadata } from "next";
import { formatDateTime } from "@/core/i18n";
import { currentBusiness } from "@/core/settings/read";
import { listMembers, membershipRules } from "@/modules/members/service";
import { Button, Callout, Card, CardBody, CardHeader, Field, Input, Pill, Select } from "@/ui/primitives";
import { getLocale, getT } from "../../../i18n";
import { requireStaffActor } from "../guard";
import { inviteMemberAction, reviewListingAction, saveMarketRulesAction, saveMembershipRulesAction, setMemberStatusAction } from "./actions";
import { pendingListings } from "@/modules/members/listings";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

const FILTERS = ["all", "pending", "active", "suspended"] as const;

export default async function MembersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string; saved?: string; error?: string }>;
}) {
  const actor = await requireStaffActor("members", "view");
  const query = await searchParams;
  const status = FILTERS.includes(query.status as (typeof FILTERS)[number]) && query.status !== "all"
    ? (query.status as "pending" | "active" | "suspended")
    : undefined;
  const [t, locale, business, rules, result] = await Promise.all([
    getT(),
    getLocale(),
    currentBusiness(),
    membershipRules.call({}, actor),
    listMembers.call({ status, search: query.q || undefined, limit: 100 }, actor),
  ]);
  const waiting = await pendingListings.call({}, actor);
  const back = `/admin/members?status=${status ?? "all"}${query.q ? `&q=${encodeURIComponent(query.q)}` : ""}`;
  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold">{t("members.admin.title")}</h1>
        <p className="text-ink-muted">{t("members.admin.intro")}</p>
      </div>
      {query.saved ? <Callout tone="success">{t("members.admin.saved")}</Callout> : null}
      {query.error ? <Callout tone="danger">{query.error}</Callout> : null}

      <Card>
        <CardHeader title={t("members.admin.rules")} />
        <CardBody>
          <form action={saveMembershipRulesAction} className="grid gap-4 sm:grid-cols-3 sm:items-end">
            <Field label={t("members.admin.joinPolicy")} htmlFor="joinPolicy">
              <Select id="joinPolicy" name="joinPolicy" defaultValue={rules.joinPolicy}>
                <option value="open">{t("members.policy.open")}</option>
                <option value="approval">{t("members.policy.approval")}</option>
                <option value="invite">{t("members.policy.invite")}</option>
              </Select>
            </Field>
            <Field label={t("members.admin.minimumAge")} htmlFor="minimumAge">
              <Input id="minimumAge" name="minimumAge" type="number" min={13} max={21} defaultValue={rules.minimumAge} />
            </Field>
            <Button type="submit">{t("members.admin.saveRules")}</Button>
          </form>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("members.admin.market")} />
        <CardBody>
          <form action={saveMarketRulesAction} className="grid gap-3">
            <label className="flex items-start gap-2">
              <input type="checkbox" name="marketplaceEnabled" value="yes" defaultChecked={rules.marketplaceEnabled} />
              <span>{t("members.admin.marketEnabled")}</span>
            </label>
            <label className="flex items-start gap-2">
              <input type="checkbox" name="listingReview" value="yes" defaultChecked={rules.listingReview} />
              <span>{t("members.admin.listingReview")}</span>
            </label>
            <p className="text-sm text-ink-muted">{t("members.listings.notYetSelling")}</p>
            <div><Button type="submit">{t("members.admin.saveRules")}</Button></div>
          </form>
          {waiting.length ? (
            <ul className="mt-4 grid gap-3">
              {waiting.map((l) => (
                <li key={l.productId} className="grid gap-2 rounded-md border border-rule p-3">
                  <p><strong>{l.name}</strong> · {t(`members.listings.kind.${l.kind}`)} · @{l.sellerHandle}</p>
                  <form action={reviewListingAction} className="flex flex-wrap items-end gap-3">
                    <input type="hidden" name="productId" value={l.productId} />
                    <Field label={t("members.admin.listingNote")} htmlFor={`note-${l.productId}`}>
                      <Input id={`note-${l.productId}`} name="note" maxLength={500} />
                    </Field>
                    <Button type="submit" name="decision" value="approve">{t("members.admin.approveListing")}</Button>
                    <Button type="submit" name="decision" value="reject" variant="danger">{t("members.admin.rejectListing")}</Button>
                  </form>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-4 text-sm text-ink-muted">{t("members.admin.noPendingListings")}</p>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("members.admin.invite")} />
        <CardBody>
          <form action={inviteMemberAction} className="flex flex-wrap items-end gap-3">
            <Field label={t("members.admin.inviteEmail")} htmlFor="invite-email">
              <Input id="invite-email" name="email" type="email" required />
            </Field>
            <Button type="submit">{t("members.admin.sendInvite")}</Button>
          </form>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("members.admin.list", { count: result.total })} />
        <CardBody>
          <nav aria-label={t("members.admin.filter")} className="mb-4 flex flex-wrap gap-3">
            {FILTERS.map((filter) => (
              <a
                key={filter}
                href={`/admin/members?status=${filter}`}
                aria-current={(status ?? "all") === filter ? "page" : undefined}
                className="underline"
              >
                {t(`members.filter.${filter}`)}
              </a>
            ))}
          </nav>
          <form className="mb-4 flex flex-wrap items-end gap-3" action="/admin/members">
            <input type="hidden" name="status" value={status ?? "all"} />
            <Field label={t("members.admin.search")} htmlFor="member-search">
              <Input id="member-search" name="q" defaultValue={query.q ?? ""} />
            </Field>
            <Button type="submit" variant="quiet">{t("members.admin.searchButton")}</Button>
          </form>
          {result.members.length === 0 ? (
            <p>{t("members.admin.empty")}</p>
          ) : (
            <ul className="grid gap-3">
              {result.members.map((member) => (
                <li key={member.userId} className="grid gap-2 rounded-md border border-rule p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <strong>{member.displayName}</strong>
                    <span>@{member.handle}</span>
                    <Pill tone={member.status === "suspended" ? "danger" : member.status === "pending" ? "warning" : "success"}>
                      {t(`members.status.${member.status}`)}
                    </Pill>
                    {member.isAdult ? <Pill>{t("members.admin.adult")}</Pill> : null}
                  </div>
                  <p className="text-sm text-ink-muted">
                    {member.email} · {t("members.admin.joined", { date: formatDateTime(member.createdAt, business?.timezone ?? "UTC", locale) })}
                  </p>
                  {member.statusReason ? <p className="text-sm">{t("members.admin.reason", { reason: member.statusReason })}</p> : null}
                  <form action={setMemberStatusAction} className="flex flex-wrap items-end gap-3">
                    <input type="hidden" name="userId" value={member.userId} />
                    <input type="hidden" name="back" value={back} />
                    {member.status !== "active" ? (
                      <Button type="submit" name="status" value="active">
                        {t(member.status === "pending" ? "members.admin.approve" : "members.admin.reactivate")}
                      </Button>
                    ) : (
                      <>
                        <Field label={t("members.admin.suspendReason")} htmlFor={`reason-${member.userId}`}>
                          <Input id={`reason-${member.userId}`} name="reason" maxLength={500} />
                        </Field>
                        <Button type="submit" name="status" value="suspended" variant="danger">
                          {t("members.admin.suspend")}
                        </Button>
                      </>
                    )}
                  </form>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
