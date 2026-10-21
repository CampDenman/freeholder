// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Loyalty: what earns points, what they buy, and what they cost you
// (C9.11, C9.12, MASTER.md §4.13).
//
// One screen with the programme chosen by query parameter rather than a route
// per programme. §4.13 says "one per instance in practice; the table allows
// more", so a nested route would spend a URL segment on a choice almost nobody
// makes, and a tab strip on a list of one.
//
// The liability figure is at the top, not the bottom. §4.13: "Outstanding
// points are a liability, and the owner is shown the number ... A loyalty
// programme whose cost is invisible is how a business gives away a margin it
// never measured." Putting it below the reward catalogue would make it
// something an owner scrolls past while designing the thing that creates it.
import type { Metadata } from "next";
import { Button, Card, CardBody, CardHeader, Field, Input, Pill, Select } from "@/ui/primitives";
import { currentBusiness } from "@/core/settings/read";
import { formatMoney } from "@/core/i18n";
import { listContacts } from "@/core/contacts/service";
import {
  catalogue,
  earnableEvents,
  liability,
  listEarnRules,
  programs,
  redemptionHistory,
  tiers,
} from "@/modules/loyalty/service";
import { getT } from "../../../i18n";
import { requireStaffActor } from "../guard";
import { domainOrNull } from "../../read-helpers";
import {
  adjustPointsAction,
  saveEarnRuleAction,
  saveProgramAction,
  saveRewardAction,
  saveTierAction,
} from "../../loyalty-actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function LoyaltyPage({
  searchParams,
}: {
  searchParams: Promise<{ program?: string; saved?: string; error?: string }>;
}) {
  const actor = await requireStaffActor("loyalty", "manage");
  const query = await searchParams;
  const [t, business, all, events, people] = await Promise.all([
    getT(),
    currentBusiness(),
    domainOrNull(programs.call({}, actor)),
    domainOrNull(earnableEvents.call({}, actor)),
    domainOrNull(listContacts.call({ limit: 200 }, actor)),
  ]);

  const chosen = (all ?? []).find((each) => each.id === query.program) ?? (all ?? [])[0] ?? null;

  const [rules, levels, rewards, redeemed, owed] = chosen
    ? await Promise.all([
        domainOrNull(listEarnRules.call({ programId: chosen.id }, actor)),
        domainOrNull(tiers.call({ programId: chosen.id }, actor)),
        domainOrNull(catalogue.call({ programId: chosen.id }, actor)),
        domainOrNull(redemptionHistory.call({ programId: chosen.id, limit: 50 }, actor)),
        domainOrNull(liability.call({ programId: chosen.id }, actor)),
      ])
    : [null, null, null, null, null];

  const locale = business?.defaultLocale ?? "en";
  // `formatMoney`, never a division: §15.4 forbids float maths on money, and
  // a currency with three decimal places or none would make /100 simply wrong.
  const money = (minor: number, currency: string) => formatMoney(minor, currency, locale);
  const when = (value: Date | string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(value));

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight">{t("loyalty.title")}</h1>
        <p className="mt-1 max-w-prose text-sm text-ink-muted">{t("loyalty.intro")}</p>
      </div>

      {query.saved ? (
        <p className="rounded-md border border-success bg-success-soft px-3 py-2 text-sm text-success">
          {t("loyalty.saved")}
        </p>
      ) : null}
      {query.error ? (
        <p className="rounded-md border border-danger bg-danger-soft px-3 py-2 text-sm text-danger">
          {query.error}
        </p>
      ) : null}

      {(all ?? []).length > 1 ? (
        <form method="get" className="flex flex-wrap items-end gap-2">
          <Field label={t("loyalty.field.programme")} htmlFor="program">
            <Select id="program" name="program" defaultValue={chosen?.id ?? ""}>
              {(all ?? []).map((programme) => (
                <option key={programme.id} value={programme.id}>
                  {programme.name}
                </option>
              ))}
            </Select>
          </Field>
          <Button type="submit" variant="quiet">
            {t("loyalty.action.switch")}
          </Button>
        </form>
      ) : null}

      {/* The cost, before the things that create it. */}
      {chosen && owed ? (
        <Card>
          <CardHeader title={t("loyalty.liability")} />
          <CardBody>
            <div className="flex flex-wrap items-baseline gap-6">
              <p className="text-2xl font-bold tabular-nums">
                {money(owed.valueMinor, owed.currency)}
              </p>
              <p className="text-sm text-ink-muted">
                {t("loyalty.liabilityDetail", {
                  points: String(owed.outstandingPoints),
                  label: chosen.pointsLabel,
                  accounts: String(owed.accounts),
                })}
              </p>
            </div>
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardHeader title={chosen ? t("loyalty.programme") : t("loyalty.newProgramme")} />
        <CardBody>
          <form action={saveProgramAction} className="grid gap-3 md:grid-cols-3">
            {chosen ? <input type="hidden" name="id" value={chosen.id} /> : null}
            <Field label={t("loyalty.field.name")} htmlFor="name">
              <Input id="name" name="name" defaultValue={chosen?.name ?? ""} required />
            </Field>
            <Field
              label={t("loyalty.field.pointsLabel")}
              htmlFor="pointsLabel"
              hint={t("loyalty.field.pointsLabelHint")}
            >
              <Input
                id="pointsLabel"
                name="pointsLabel"
                defaultValue={chosen?.pointsLabel ?? "points"}
              />
            </Field>
            <Field label={t("loyalty.field.status")} htmlFor="status">
              <Select id="status" name="status" defaultValue={chosen?.status ?? "draft"}>
                <option value="draft">{t("loyalty.status.draft")}</option>
                <option value="active">{t("loyalty.status.active")}</option>
                <option value="closed">{t("loyalty.status.closed")}</option>
              </Select>
            </Field>
            <Field label={t("loyalty.field.currency")} htmlFor="earnCurrency">
              <Input
                id="earnCurrency"
                name="earnCurrency"
                defaultValue={chosen?.earnCurrency ?? business?.baseCurrency ?? "USD"}
                maxLength={3}
              />
            </Field>
            <Field
              label={t("loyalty.field.redemptionValue")}
              htmlFor="redemptionValueCents"
              hint={t("loyalty.field.redemptionValueHint")}
            >
              <Input
                id="redemptionValueCents"
                name="redemptionValueCents"
                type="number"
                min={1}
                defaultValue={chosen?.redemptionValueCents ?? 1}
              />
            </Field>
            <Field label={t("loyalty.field.enrolment")} htmlFor="enrolment">
              <Select id="enrolment" name="enrolment" defaultValue={chosen?.enrolment ?? "opt_in"}>
                <option value="opt_in">{t("loyalty.enrolment.opt_in")}</option>
                <option value="automatic">{t("loyalty.enrolment.automatic")}</option>
              </Select>
            </Field>
            <Field
              label={t("loyalty.field.minAccountAge")}
              htmlFor="minAccountAgeDays"
              hint={t("loyalty.field.minAccountAgeHint")}
            >
              <Input
                id="minAccountAgeDays"
                name="minAccountAgeDays"
                type="number"
                min={0}
                defaultValue={chosen?.minAccountAgeDays ?? 0}
              />
            </Field>
            <div className="flex items-end">
              <Button type="submit">{t("loyalty.action.saveProgramme")}</Button>
            </div>
          </form>
        </CardBody>
      </Card>

      {chosen ? (
        <>
          <Card>
            <CardHeader title={t("loyalty.earning")} />
            <CardBody>
              {rules === null || rules.length === 0 ? (
                <p className="max-w-prose text-sm text-ink-muted">{t("loyalty.noRules")}</p>
              ) : (
                <ul className="grid list-none gap-2 p-0">
                  {rules.map((rule) => (
                    <li
                      key={rule.id}
                      className="flex flex-wrap items-center gap-3 rounded-md border border-rule p-3 text-sm"
                    >
                      <span className="font-medium">{rule.name}</span>
                      <code className="font-mono text-xs">{rule.eventType}</code>
                      <span className="tabular-nums">
                        {t(`loyalty.formula.${rule.formula}`, { points: String(rule.points) })}
                      </span>
                      {rule.capPerPeriod ? (
                        <span className="text-ink-muted">
                          {t("loyalty.cap", {
                            cap: String(rule.capPerPeriod),
                            days: String(rule.capPeriodDays),
                          })}
                        </span>
                      ) : null}
                      <Pill tone={rule.active === "yes" ? "success" : "neutral"}>
                        {t(`loyalty.active.${rule.active}`)}
                      </Pill>
                    </li>
                  ))}
                </ul>
              )}

              <form action={saveEarnRuleAction} className="mt-3 grid gap-3 md:grid-cols-3">
                <input type="hidden" name="programId" value={chosen.id} />
                <Field label={t("loyalty.field.ruleName")} htmlFor="ruleName">
                  <Input id="ruleName" name="name" required maxLength={120} />
                </Field>
                <Field
                  label={t("loyalty.field.event")}
                  htmlFor="eventType"
                  hint={t("loyalty.field.eventHint")}
                >
                  {/* Only what this module actually listens for. `saveEarnRule`
                      already refuses anything else, and a picker that offered
                      it would be setting the owner up to fail. */}
                  <Select id="eventType" name="eventType" required defaultValue="">
                    <option value="">—</option>
                    {(events ?? []).map((event) => (
                      <option key={event.eventType} value={event.eventType}>
                        {event.eventType}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={t("loyalty.field.formula")} htmlFor="formula">
                  <Select id="formula" name="formula" defaultValue="fixed">
                    <option value="fixed">{t("loyalty.formulaName.fixed")}</option>
                    <option value="per_currency_unit">
                      {t("loyalty.formulaName.per_currency_unit")}
                    </option>
                    <option value="multiplier">{t("loyalty.formulaName.multiplier")}</option>
                  </Select>
                </Field>
                <Field label={t("loyalty.field.points")} htmlFor="points">
                  <Input id="points" name="points" type="number" min={0} required />
                </Field>
                <Field label={t("loyalty.field.cap")} htmlFor="capPerPeriod">
                  <Input id="capPerPeriod" name="capPerPeriod" type="number" min={1} />
                </Field>
                <Field label={t("loyalty.field.capDays")} htmlFor="capPeriodDays">
                  <Input
                    id="capPeriodDays"
                    name="capPeriodDays"
                    type="number"
                    min={1}
                    defaultValue={30}
                  />
                </Field>
                <div className="flex items-end">
                  <Button type="submit">{t("loyalty.action.addRule")}</Button>
                </div>
              </form>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title={t("loyalty.tiers")} />
            <CardBody>
              {levels === null || levels.length === 0 ? (
                <p className="max-w-prose text-sm text-ink-muted">{t("loyalty.noTiers")}</p>
              ) : (
                <ul className="grid list-none gap-2 p-0">
                  {levels.map((tier) => (
                    <li
                      key={tier.id}
                      className="flex flex-wrap items-center gap-3 rounded-md border border-rule p-3 text-sm"
                    >
                      <span className="font-medium">{tier.name}</span>
                      <span className="tabular-nums">
                        {t(`loyalty.threshold.${tier.thresholdBasis}`, {
                          n: String(tier.threshold),
                        })}
                      </span>
                      <span className="ms-auto text-ink-muted tabular-nums">#{tier.position}</span>
                    </li>
                  ))}
                </ul>
              )}

              <form action={saveTierAction} className="mt-3 grid gap-3 md:grid-cols-3">
                <input type="hidden" name="programId" value={chosen.id} />
                <Field label={t("loyalty.field.tierName")} htmlFor="tierName">
                  <Input id="tierName" name="name" required maxLength={80} />
                </Field>
                <Field label={t("loyalty.field.basis")} htmlFor="thresholdBasis">
                  <Select id="thresholdBasis" name="thresholdBasis" defaultValue="points_earned">
                    <option value="points_earned">{t("loyalty.basis.points_earned")}</option>
                    <option value="lifetime_spend">{t("loyalty.basis.lifetime_spend")}</option>
                  </Select>
                </Field>
                <Field label={t("loyalty.field.threshold")} htmlFor="threshold">
                  <Input id="threshold" name="threshold" type="number" min={0} required />
                </Field>
                <Field
                  label={t("loyalty.field.windowDays")}
                  htmlFor="windowDays"
                  hint={t("loyalty.field.windowDaysHint")}
                >
                  <Input
                    id="windowDays"
                    name="windowDays"
                    type="number"
                    min={0}
                    defaultValue={365}
                  />
                </Field>
                <Field label={t("loyalty.field.position")} htmlFor="position">
                  <Input id="position" name="position" type="number" min={0} defaultValue={0} />
                </Field>
                <div className="flex items-end">
                  <Button type="submit">{t("loyalty.action.addTier")}</Button>
                </div>
              </form>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title={t("loyalty.rewards")} />
            <CardBody>
              {rewards === null || rewards.length === 0 ? (
                <p className="max-w-prose text-sm text-ink-muted">{t("loyalty.noRewards")}</p>
              ) : (
                <ul className="grid list-none gap-2 p-0">
                  {rewards.map((reward) => (
                    <li
                      key={reward.id}
                      className="flex flex-wrap items-center gap-3 rounded-md border border-rule p-3 text-sm"
                    >
                      <span className="font-medium">{reward.name}</span>
                      <Pill tone="accent">{t(`loyalty.rewardKind.${reward.kind}`)}</Pill>
                      <span className="tabular-nums">
                        {t("loyalty.costs", {
                          points: String(reward.costPoints),
                          label: chosen.pointsLabel,
                        })}
                      </span>
                      <Pill tone={reward.status === "active" ? "success" : "neutral"}>
                        {t(`loyalty.rewardStatus.${reward.status}`)}
                      </Pill>
                    </li>
                  ))}
                </ul>
              )}

              <form action={saveRewardAction} className="mt-3 grid gap-3 md:grid-cols-3">
                <input type="hidden" name="programId" value={chosen.id} />
                <Field label={t("loyalty.field.rewardName")} htmlFor="rewardName">
                  <Input id="rewardName" name="name" required maxLength={120} />
                </Field>
                <Field label={t("loyalty.field.kind")} htmlFor="kind">
                  <Select id="kind" name="kind" required defaultValue="discount">
                    <option value="discount">{t("loyalty.rewardKind.discount")}</option>
                    <option value="free_product">{t("loyalty.rewardKind.free_product")}</option>
                    <option value="free_shipping">{t("loyalty.rewardKind.free_shipping")}</option>
                    <option value="gift_card">{t("loyalty.rewardKind.gift_card")}</option>
                    <option value="pass_credits">{t("loyalty.rewardKind.pass_credits")}</option>
                    <option value="donation">{t("loyalty.rewardKind.donation")}</option>
                  </Select>
                </Field>
                <Field label={t("loyalty.field.costPoints")} htmlFor="costPoints">
                  <Input id="costPoints" name="costPoints" type="number" min={1} required />
                </Field>
                <Field
                  label={t("loyalty.field.percentOff")}
                  htmlFor="percentOff"
                  hint={t("loyalty.field.percentOffHint")}
                >
                  <Input id="percentOff" name="percentOff" type="number" min={1} max={100} />
                </Field>
                <Field
                  label={t("loyalty.field.amountMinor")}
                  htmlFor="amountMinor"
                  hint={t("loyalty.field.amountMinorHint")}
                >
                  <Input id="amountMinor" name="amountMinor" type="number" min={1} />
                </Field>
                <Field label={t("loyalty.field.perContactLimit")} htmlFor="perContactLimit">
                  <Input id="perContactLimit" name="perContactLimit" type="number" min={1} />
                </Field>
                <div className="flex items-end">
                  <Button type="submit">{t("loyalty.action.addReward")}</Button>
                </div>
              </form>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title={t("loyalty.redemptions")} />
            <CardBody>
              {redeemed === null || redeemed.length === 0 ? (
                <p className="max-w-prose text-sm text-ink-muted">{t("loyalty.noRedemptions")}</p>
              ) : (
                <ul className="grid list-none gap-2 p-0">
                  {redeemed.map((entry) => (
                    <li
                      key={entry.id}
                      className="flex flex-wrap items-center gap-3 rounded-md border border-rule p-3 text-sm"
                    >
                      <span className="tabular-nums">−{entry.pointsSpent}</span>
                      <Pill tone={entry.status === "issued" ? "success" : "neutral"}>
                        {t(`loyalty.redemptionStatus.${entry.status}`)}
                      </Pill>
                      {/* "Manual" is the honest status §4.13 asks for: on an
                          instance with no commerce module there is a voucher
                          waiting to be written out by a person. */}
                      {entry.status === "manual" ? (
                        <span className="text-ink-muted">{t("loyalty.manualHint")}</span>
                      ) : null}
                      <span className="ms-auto text-ink-muted">{when(entry.at)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title={t("loyalty.adjust")} />
            <CardBody>
              <p className="max-w-prose text-sm text-ink-muted">{t("loyalty.adjustIntro")}</p>
              <form action={adjustPointsAction} className="mt-3 grid gap-3 md:grid-cols-4">
                <input type="hidden" name="programId" value={chosen.id} />
                <Field label={t("loyalty.field.contact")} htmlFor="contactId">
                  <Select id="contactId" name="contactId" required defaultValue="">
                    <option value="">—</option>
                    {(people?.rows ?? []).map((contact) => (
                      <option key={contact.id} value={contact.id}>
                        {contact.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field
                  label={t("loyalty.field.delta")}
                  htmlFor="delta"
                  hint={t("loyalty.field.deltaHint")}
                >
                  <Input id="delta" name="delta" type="number" required />
                </Field>
                <Field
                  label={t("loyalty.field.reason")}
                  htmlFor="note"
                  hint={t("loyalty.field.reasonHint")}
                >
                  <Input id="note" name="note" required maxLength={500} />
                </Field>
                <div className="flex items-end">
                  <Button type="submit">{t("loyalty.action.adjust")}</Button>
                </div>
              </form>
            </CardBody>
          </Card>
        </>
      ) : null}
    </div>
  );
}
