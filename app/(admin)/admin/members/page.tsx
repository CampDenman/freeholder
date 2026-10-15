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
import { disputeAction, inviteMemberAction, reportAction, payoutAccountAction, reviewListingAction, saveMarketRulesAction, saveMembershipRulesAction, setMemberStatusAction, settlePayoutsAction } from "./actions";
import { payoutAdapters, sitePayouts } from "@/modules/members/payouts";
import { listDisputes, saleThread } from "@/modules/members/protection";
import { listReports } from "@/modules/members/reports";
import { formatMoney } from "@/core/i18n";
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
  const [waiting, ledger] = await Promise.all([pendingListings.call({}, actor), sitePayouts.call({}, actor)]);
  const open = ledger.payouts.filter((p) => p.state === "held" || p.state === "due" || p.state === "review");
  const [disputes, reports] = await Promise.all([listDisputes.call({ state: "open" }, actor), listReports.call({ state: "open" }, actor)]);
  const threads = await Promise.all(disputes.map((d) => saleThread.call({ orderId: d.orderId, sellerId: d.sellerId }, actor)));
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
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("members.admin.payoutModel")} htmlFor="payoutModel" hint={t("members.admin.payoutModelHint")}>
                <Select id="payoutModel" name="payoutModel" defaultValue={rules.payoutModel}>
                  {(["hold", "instant", "seller_merchant"] as const).map((m) => <option key={m} value={m}>{t(`members.admin.model.${m}`)}</option>)}
                </Select>
              </Field>
              <Field label={t("members.admin.payoutAdapter")} htmlFor="payoutAdapter">
                <Select id="payoutAdapter" name="payoutAdapter" defaultValue={rules.payoutAdapter}>
                  {payoutAdapters().map((a) => <option key={a.id} value={a.id}>{t(`members.admin.adapter.${a.id}`)}</option>)}
                </Select>
              </Field>
              <Field label={t("members.admin.holdDays")} htmlFor="holdDays">
                <Input id="holdDays" name="holdDays" type="number" min={1} max={90} defaultValue={rules.holdDays} />
              </Field>
              <Field label={t("members.admin.siteFee")} htmlFor="siteFeePercent" hint={t("members.admin.siteFeeHint")}>
                <Input id="siteFeePercent" name="siteFeePercent" type="number" min={0} max={50} step={0.1} defaultValue={rules.siteFeeBps / 100} />
              </Field>
            </div>
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
        <CardHeader title={t("members.admin.reports", { count: reports.length })} />
        <CardBody>
          {reports.length === 0 ? <p className="text-sm text-ink-muted">{t("members.admin.noReports")}</p> : null}
          <ul className="grid gap-4">
            {reports.map((r) => (
              <li key={r.id} className="grid gap-2 rounded-md border border-rule p-3">
                <p>
                  <strong>{t(`members.report.reasons.${r.reason}`)}</strong> · {t(`members.report.targets.${r.targetType}`)} · <a className="underline" href={`/@${r.subject.handle}`}>@{r.subject.handle}</a>
                  {r.reporterCount > 1 ? <> · {t("members.admin.reporters", { count: r.reporterCount })}</> : null}
                </p>
                <blockquote className="whitespace-pre-line break-words border-s-2 border-rule ps-3 text-sm">{r.excerpt}</blockquote>
                {r.details ? <p className="text-sm text-ink-muted">{t("members.admin.reporterSaid", { details: r.details })}</p> : null}
                <form action={reportAction} className="flex flex-wrap items-end gap-3">
                  <input type="hidden" name="id" value={r.id} />
                  <Field label={t("members.admin.reportNote")} htmlFor={`report-${r.id}`}>
                    <Input id={`report-${r.id}`} name="note" maxLength={1000} />
                  </Field>
                  {r.targetType !== "member" ? <Button type="submit" name="decision" value="remove" variant="danger">{t("members.admin.reportRemove")}</Button> : null}
                  {r.targetType !== "member" ? <Button type="submit" name="decision" value="remove_and_suspend" variant="danger">{t("members.admin.reportRemoveSuspend")}</Button> : null}
                  {r.targetType === "member" ? <Button type="submit" name="decision" value="suspend" variant="danger">{t("members.admin.reportSuspend")}</Button> : null}
                  <Button type="submit" name="decision" value="dismiss" variant="quiet">{t("members.admin.reportDismiss")}</Button>
                </form>
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("members.admin.disputes", { count: disputes.length })} />
        <CardBody>
          {disputes.length === 0 ? <p className="text-sm text-ink-muted">{t("members.admin.noDisputes")}</p> : null}
          <ul className="grid gap-4">
            {disputes.map((d, i) => (
              <li key={d.id} className="grid gap-2 rounded-md border border-rule p-3">
                <p><strong>{t(`members.sales.reasons.${d.reason}`)}</strong> · @{d.sellerHandle}</p>
                <ol className="grid gap-1 text-sm">
                  {threads[i]!.map((m) => <li key={m.id}><span className="text-ink-muted">{t(`members.sales.role.${m.role}`)}:</span> {m.body}</li>)}
                </ol>
                <form action={disputeAction} className="flex flex-wrap items-end gap-3">
                  <input type="hidden" name="id" value={d.id} />
                  <input type="hidden" name="orderId" value={d.orderId} />
                  <input type="hidden" name="sellerId" value={d.sellerId} />
                  <Field label={t("members.admin.disputeNote")} htmlFor={`dispute-${d.id}`}>
                    <Input id={`dispute-${d.id}`} name="note" required minLength={3} maxLength={2000} />
                  </Field>
                  <Button type="submit" name="outcome" value="message" variant="quiet">{t("members.admin.disputeReply")}</Button>
                  <Button type="submit" name="outcome" value="release">{t("members.admin.disputeRelease")}</Button>
                  <Button type="submit" name="outcome" value="refund" variant="danger">{t("members.admin.disputeRefund")}</Button>
                </form>
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("members.admin.payouts")} />
        <CardBody>
          <h3 className="mb-2 font-semibold">{t("members.admin.sellerAccounts")}</h3>
          {ledger.accounts.length === 0 ? <p className="text-sm text-ink-muted">{t("members.admin.noSellerAccounts")}</p> : null}
          <ul className="mb-6 grid gap-2">
            {ledger.accounts.map((a) => (
              <li key={a.userId} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-rule p-3">
                <span>@{a.handle} · <span className="text-sm">{a.instructions}</span></span>
                <form action={payoutAccountAction} className="flex items-center gap-2">
                  <input type="hidden" name="userId" value={a.userId} />
                  <Pill tone={a.status === "ready" ? "success" : "warning"}>{t(`members.payouts.account.${a.status}`)}</Pill>
                  {a.status !== "ready" ? <Button type="submit" name="status" value="ready">{t("members.admin.confirmAccount")}</Button> : <Button type="submit" name="status" value="disabled" variant="quiet">{t("members.admin.disableAccount")}</Button>}
                </form>
              </li>
            ))}
          </ul>
          <h3 className="mb-2 font-semibold">{t("members.admin.openPayouts")}</h3>
          {open.length === 0 ? <p className="text-sm text-ink-muted">{t("members.admin.noOpenPayouts")}</p> : (
            <form action={settlePayoutsAction} className="grid gap-3">
              <ul className="grid gap-2">
                {open.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center gap-3 rounded-md border border-rule p-3 text-sm">
                    <input type="checkbox" name="ids" value={p.id} id={`payout-${p.id}`} />
                    <label htmlFor={`payout-${p.id}`}>@{p.sellerHandle} · {formatMoney(p.netMinor, p.currency, locale)}</label>
                    <Pill>{t(`members.payouts.state.${p.state}`)}</Pill>
                    {p.note ? <span className="text-ink-muted">{p.note}</span> : null}
                  </li>
                ))}
              </ul>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={t("members.admin.payoutReference")} htmlFor="payout-reference"><Input id="payout-reference" name="reference" maxLength={200} /></Field>
                <Field label={t("members.admin.payoutNote")} htmlFor="payout-note"><Input id="payout-note" name="note" maxLength={500} /></Field>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="submit" name="action" value="release" variant="quiet">{t("members.admin.releasePayouts")}</Button>
                <Button type="submit" name="action" value="paid">{t("members.admin.markPaid")}</Button>
                <Button type="submit" name="action" value="owe" variant="quiet">{t("members.admin.stillOwed")}</Button>
                <Button type="submit" name="action" value="cancel" variant="danger">{t("members.admin.cancelPayouts")}</Button>
              </div>
            </form>
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
