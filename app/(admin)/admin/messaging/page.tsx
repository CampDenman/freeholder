// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The numbers a business texts from (C7.10, MASTER.md §4.14).
//
// The screen exists mostly to answer one question before it becomes a problem:
// **can these numbers actually send?** §4.14 names the failure — "an
// unregistered number silently filtered by carriers is the most common way an
// SMS launch fails" — and the shape of that failure is a number that looks
// perfectly fine everywhere except at the carrier.
//
// So health is shown with the moment it was checked and with whether the check
// itself worked. "Not checked" and "checked, fine" are different things, and a
// screen that renders them the same way is the screen that lets a launch fail.
//
// Numbers are *imported*, never bought. Buying spends the owner's money on a
// vendor's terms in a country with its own rules about who may hold one; that
// belongs in the provider's console.
import type { Metadata } from "next";
import { Button, Card, CardBody, CardHeader, Pill, type Tone } from "@/ui/primitives";
import { currentBusiness } from "@/core/settings/read";
import { listMessagingNumbers, numberRegistrations } from "@/core/messaging/sms";
import { KEYWORD_ACTIONS, KEYWORD_MATCH_KINDS, listKeywordRules } from "@/core/messaging/keywords";
import { listMessagingWindows } from "@/core/messaging/policy";
import { listSmsComplianceEvents } from "@/core/messaging/consent";
import { formatDateTime } from "@/core/i18n";
import { getT } from "../../../i18n";
import { requireStaffActor } from "../guard";
import { domainOrNull } from "../../read-helpers";
import {
  checkNumbersAction,
  createKeywordRuleAction,
  deleteKeywordRuleAction,
  importNumbersAction,
  setMessagingWindowAction,
  setRegistrationAction,
  updateNumberAction,
} from "../../messaging-actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

const PURPOSES = ["transactional", "marketing", "support"] as const;

export default async function MessagingPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const actor = await requireStaffActor("crm", "manage");
  const [t, business, numbers, registrations, query, keywords, windows, compliance] = await Promise.all([
    getT(),
    currentBusiness(),
    domainOrNull(listMessagingNumbers.call({}, actor)),
    domainOrNull(numberRegistrations.call({}, actor)),
    searchParams,
    domainOrNull(listKeywordRules.call({ includeInactive: true }, actor)),
    domainOrNull(listMessagingWindows.call({}, actor)),
    domainOrNull(listSmsComplianceEvents.call({}, actor)),
  ]);

  const locale = business?.defaultLocale ?? "en";
  const timezone = business?.timezone ?? "UTC";

  /** Three states, not two: fine, wrong, and nobody could ask. */
  const healthTone = (number: { healthy: boolean; healthUnknown: boolean }): Tone =>
    number.healthUnknown ? "warning" : number.healthy ? "success" : "danger";

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight">{t("messaging.title")}</h1>
        <p className="mt-1 max-w-prose text-sm text-ink-muted">{t("messaging.intro")}</p>
      </div>

      {query.saved ? (
        <p className="rounded-md border border-success bg-success-soft px-3 py-2 text-sm text-success">
          {t("messaging.saved")}
        </p>
      ) : null}
      {query.error ? (
        <p className="rounded-md border border-danger bg-danger-soft px-3 py-2 text-sm text-danger">
          {query.error.includes(" ") ? query.error : t("messaging.failed")}
        </p>
      ) : null}

      <Card>
        <CardHeader title={t("messaging.numbers")} />
        <CardBody>
          {numbers === null ? (
            <p className="text-sm text-danger">{t("messaging.unavailable")}</p>
          ) : numbers.length === 0 ? (
            <p className="max-w-prose text-sm text-ink-muted">{t("messaging.empty")}</p>
          ) : (
            <ul className="grid list-none gap-2 p-0">
              {numbers.map((number) => (
                <li key={number.id} className="grid gap-2 rounded-md border border-rule p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="font-mono font-medium">{number.e164}</span>
                    {number.label ? <span>{number.label}</span> : null}
                    <Pill tone="neutral">{t(`messaging.kind.${number.kind}`)}</Pill>
                    {number.country ? (
                      <span className="text-ink-muted">{number.country}</span>
                    ) : null}
                    <Pill tone={healthTone(number)}>
                      {number.healthUnknown
                        ? t("messaging.health.unknown")
                        : number.healthy
                          ? t("messaging.health.ok")
                          : t("messaging.health.bad")}
                    </Pill>
                    {/* The date matters as much as the verdict: a green tick
                        from six months ago is not an answer about today. */}
                    {number.healthCheckedAt ? (
                      <span className="text-xs text-ink-muted">
                        {t("messaging.checkedAt", {
                          when: formatDateTime(number.healthCheckedAt, timezone, locale),
                        })}
                      </span>
                    ) : (
                      <span className="text-xs text-ink-muted">
                        {t("messaging.health.never")}
                      </span>
                    )}
                    {number.isDefault ? (
                      <Pill tone="accent">{t("messaging.isDefault")}</Pill>
                    ) : null}
                  </div>
                  {number.healthProblem ? (
                    <p className="text-sm text-danger">{number.healthProblem}</p>
                  ) : null}

                  {/* §4.14: registration status is surfaced here because an
                      unregistered number silently filtered by carriers is the
                      most common way an SMS launch fails — and the whole shape
                      of that failure is that nothing else tells you. What is
                      *required* is derived from country and kind, so it cannot
                      be dismissed; only how far along it is can be recorded. */}
                  {(() => {
                    const registration = (registrations ?? []).find(
                      (one) => one.id === number.id,
                    );
                    if (!registration || registration.required.length === 0) return null;
                    return (
                      <div className="grid gap-2 rounded-md border border-rule p-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <Pill tone={registration.canSend ? "success" : "danger"}>
                            {registration.canSend
                              ? t("messaging.reg.ready")
                              : t("messaging.reg.blocked")}
                          </Pill>
                          <span className="text-sm font-medium">
                            {t("messaging.reg.title")}
                          </span>
                        </div>
                        {registration.problem ? (
                          <p className="max-w-prose text-sm text-ink-muted">
                            {registration.problem}
                          </p>
                        ) : null}
                        {registration.required.map((requirement) => (
                          <form
                            key={requirement.kind}
                            action={setRegistrationAction}
                            className="flex flex-wrap items-end gap-3"
                          >
                            <input type="hidden" name="id" value={number.id} />
                            <input type="hidden" name="kind" value={requirement.kind} />
                            <span className="text-sm">
                              {t(`messaging.reg.kind.${requirement.kind}`)}
                            </span>
                            <label className="grid gap-1 text-sm">
                              <span className="text-ink-muted">
                                {t("messaging.reg.state")}
                              </span>
                              <select
                                name="state"
                                defaultValue={requirement.state}
                                className="rounded-md border border-rule-strong bg-field px-2 py-1 text-sm"
                              >
                                {[
                                  "not_started",
                                  "submitted",
                                  "in_review",
                                  "approved",
                                  "rejected",
                                  "expired",
                                ].map((state) => (
                                  <option key={state} value={state}>
                                    {t(`messaging.reg.state.${state}`)}
                                  </option>
                                ))}
                              </select>
                            </label>
                            {requirement.kind === "10dlc" ? (
                              <>
                                <label className="grid gap-1 text-sm">
                                  <span className="text-ink-muted">
                                    {t("messaging.reg.brand")}
                                  </span>
                                  <input
                                    name="brand"
                                    defaultValue={requirement.brand ?? ""}
                                    className="rounded-md border border-rule-strong bg-field px-2 py-1 text-sm"
                                  />
                                </label>
                                <label className="grid gap-1 text-sm">
                                  <span className="text-ink-muted">
                                    {t("messaging.reg.campaign")}
                                  </span>
                                  <input
                                    name="campaign"
                                    defaultValue={requirement.campaign ?? ""}
                                    className="rounded-md border border-rule-strong bg-field px-2 py-1 text-sm"
                                  />
                                </label>
                              </>
                            ) : null}
                            <label className="grid gap-1 text-sm">
                              <span className="text-ink-muted">
                                {t("messaging.reg.reason")}
                              </span>
                              <input
                                name="reason"
                                defaultValue={requirement.reason ?? ""}
                                className="rounded-md border border-rule-strong bg-field px-2 py-1 text-sm"
                              />
                            </label>
                            <Button type="submit" variant="quiet">
                              {t("messaging.action.save")}
                            </Button>
                          </form>
                        ))}
                      </div>
                    );
                  })()}
                  <form action={updateNumberAction} className="flex flex-wrap items-end gap-3">
                    <input type="hidden" name="id" value={number.id} />
                    <label className="grid gap-1">
                      <span className="text-ink-muted">{t("messaging.field.label")}</span>
                      <input
                        name="label"
                        defaultValue={number.label ?? ""}
                        className="rounded-md border border-rule-strong bg-field px-2 py-1 text-sm"
                      />
                    </label>
                    <label className="grid gap-1">
                      <span className="text-ink-muted">{t("messaging.field.purpose")}</span>
                      <select
                        name="purpose"
                        defaultValue={number.purpose}
                        className="rounded-md border border-rule-strong bg-field px-2 py-1 text-sm"
                      >
                        {PURPOSES.map((purpose) => (
                          <option key={purpose} value={purpose}>
                            {t(`messaging.purpose.${purpose}`)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        name="isDefault"
                        defaultChecked={number.isDefault}
                      />
                      <span className="text-ink-muted">{t("messaging.field.isDefault")}</span>
                    </label>
                    <label className="flex items-center gap-2">
                      <input type="checkbox" name="active" defaultChecked={number.active} />
                      <span className="text-ink-muted">{t("messaging.field.active")}</span>
                    </label>
                    <Button type="submit" variant="quiet">
                      {t("messaging.action.save")}
                    </Button>
                  </form>
                </li>
              ))}
            </ul>
          )}

          <div className="flex flex-wrap gap-3">
            <form action={importNumbersAction}>
              <Button type="submit" variant="quiet">
                {t("messaging.action.import")}
              </Button>
            </form>
            <form action={checkNumbersAction}>
              <Button type="submit" variant="quiet">
                {t("messaging.action.check")}
              </Button>
            </form>
          </div>
          {/* Imported, never bought. */}
          <p className="max-w-prose text-sm text-ink-muted">{t("messaging.importHint")}</p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("messaging.keywords.title")} />
        <CardBody>
          <p className="max-w-prose text-sm text-ink-muted">{t("messaging.keywords.intro")}</p>
          {keywords === null ? (
            <p className="text-sm text-danger">{t("messaging.unavailable")}</p>
          ) : keywords.length === 0 ? (
            <p className="mt-2 text-sm text-ink-muted">{t("messaging.keywords.empty")}</p>
          ) : (
            <ul className="mt-3 grid list-none gap-2 p-0">
              {keywords.map((rule) => (
                <li key={rule.id} className="flex flex-wrap items-center gap-3 rounded-md border border-rule p-3 text-sm">
                  <span className="font-mono font-medium">{rule.keyword}</span>
                  <Pill tone="neutral">{t(`messaging.keywords.match.${rule.match}`)}</Pill>
                  <span>{t(`messaging.keywords.action.${rule.action}`)}</span>
                  <form action={deleteKeywordRuleAction} className="ms-auto">
                    <input type="hidden" name="id" value={rule.id} />
                    <Button type="submit" variant="danger">{t("messaging.keywords.delete")}</Button>
                  </form>
                </li>
              ))}
            </ul>
          )}
          <form action={createKeywordRuleAction} className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-sm">
              <span className="text-ink-muted">{t("messaging.keywords.keyword")}</span>
              <input name="keyword" required className="rounded-md border border-rule-strong bg-field px-2 py-1 text-sm" />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="text-ink-muted">{t("messaging.keywords.match")}</span>
              <select name="match" defaultValue="exact" className="rounded-md border border-rule-strong bg-field px-2 py-1 text-sm">
                {KEYWORD_MATCH_KINDS.map((kind) => (
                  <option key={kind} value={kind}>{t(`messaging.keywords.match.${kind}`)}</option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-sm">
              <span className="text-ink-muted">{t("messaging.keywords.action")}</span>
              <select name="action" defaultValue="auto_reply" className="rounded-md border border-rule-strong bg-field px-2 py-1 text-sm">
                {KEYWORD_ACTIONS.map((kind) => (
                  <option key={kind} value={kind}>{t(`messaging.keywords.action.${kind}`)}</option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-sm">
              <span className="text-ink-muted">{t("messaging.keywords.reply")}</span>
              <input name="replyBody" className="rounded-md border border-rule-strong bg-field px-2 py-1 text-sm" />
            </label>
            <div>
              <Button type="submit">{t("messaging.keywords.add")}</Button>
            </div>
          </form>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("messaging.windows.title")} />
        <CardBody>
          <p className="max-w-prose text-sm text-ink-muted">{t("messaging.windows.intro")}</p>
          {windows === null ? (
            <p className="text-sm text-danger">{t("messaging.unavailable")}</p>
          ) : windows.length === 0 ? (
            <p className="mt-2 text-sm text-ink-muted">{t("messaging.windows.empty")}</p>
          ) : (
            <ul className="mt-3 grid list-none gap-2 p-0">
              {windows.map((window) => (
                <li key={window.id} className="flex flex-wrap items-center gap-3 rounded-md border border-rule p-3 text-sm">
                  <span className="font-medium">{window.name}</span>
                  {window.quietFrom && window.quietTo ? (
                    <span className="font-mono text-ink-muted">
                      {window.quietFrom}–{window.quietTo}
                    </span>
                  ) : null}
                  {window.maxPerDay ? (
                    <span className="text-ink-muted">{t("messaging.windows.maxPerDay")}: {window.maxPerDay}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          <form action={setMessagingWindowAction} className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-sm">
              <span className="text-ink-muted">{t("messaging.windows.name")}</span>
              <input name="name" required className="rounded-md border border-rule-strong bg-field px-2 py-1 text-sm" />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="text-ink-muted">{t("messaging.windows.quietFrom")}</span>
              <input name="quietFrom" type="time" className="rounded-md border border-rule-strong bg-field px-2 py-1 text-sm" />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="text-ink-muted">{t("messaging.windows.quietTo")}</span>
              <input name="quietTo" type="time" className="rounded-md border border-rule-strong bg-field px-2 py-1 text-sm" />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="text-ink-muted">{t("messaging.windows.maxPerDay")}</span>
              <input name="maxPerDay" inputMode="numeric" className="rounded-md border border-rule-strong bg-field px-2 py-1 text-sm" />
            </label>
            <div>
              <Button type="submit">{t("messaging.windows.add")}</Button>
            </div>
          </form>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("messaging.compliance.title")} />
        <CardBody>
          {compliance === null ? (
            <p className="text-sm text-danger">{t("messaging.unavailable")}</p>
          ) : compliance.length === 0 ? (
            <p className="text-sm text-ink-muted">{t("messaging.compliance.empty")}</p>
          ) : (
            <ul className="grid list-none gap-2 p-0">
              {compliance.slice(0, 20).map((event) => (
                <li key={event.id} className="flex flex-wrap items-center gap-3 text-sm">
                  <Pill tone="neutral">{t(`messaging.compliance.intent.${event.intent}`)}</Pill>
                  <span className="font-mono">{event.keyword}</span>
                  <span className="text-ink-muted">
                    {formatDateTime(event.occurredAt, timezone, locale)}
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
