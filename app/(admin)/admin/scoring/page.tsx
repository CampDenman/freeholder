// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Scoring rules, in the open (C7.05, MASTER.md §4.14).
//
// §4.14: "Lead scoring is transparent by construction: rules over spine events
// with visible points and stated decay, never a model. An owner must be able to
// read why someone is a 40."
//
// So this page is the whole model. Every rule shows the event it listens for,
// what it is worth, how long that lasts and where it moves people — there is no
// second place where scoring is configured, and nothing here is derived from
// anything an owner cannot see. The "why is she a 40" half lives on the contact
// itself, where the question is actually asked.
import type { Metadata } from "next";
import { Button, Card, CardBody, CardHeader, Pill } from "@/ui/primitives";
import { listScoringRules, LIFECYCLE_LADDER, SCORING_RULE_KINDS } from "@/core/scoring/service";
import { getT } from "../../../i18n";
import { requireStaffActor } from "../guard";
import { domainOrNull } from "../../read-helpers";
import { removeScoringRuleAction, saveScoringRuleAction } from "../../scoring-actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * The events worth offering in a picker.
 *
 * A short, honest list of the ones a business would actually score on, rather
 * than every event the platform emits — a hundred-entry dropdown is a way of
 * making a decision nobody makes. The field accepts any event name typed in, so
 * nothing here is a ceiling.
 */
const SUGGESTED_EVENTS = [
  "contact.created",
  "form.submitted",
  "quote.sent",
  "quote.accepted",
  "booking.created",
  "order.paid",
  "invoice.paid",
  "newsletters.subscribed",
  "deal.won",
];

export default async function ScoringPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const actor = await requireStaffActor("crm");
  const [t, rules, query] = await Promise.all([
    getT(),
    domainOrNull(listScoringRules.call({}, actor)),
    searchParams,
  ]);

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight">{t("scoring.title")}</h1>
        <p className="mt-1 max-w-prose text-sm text-ink-muted">{t("scoring.intro")}</p>
      </div>

      {query.saved ? (
        <p className="rounded-md border border-success bg-success-soft px-3 py-2 text-sm text-success">
          {t("scoring.saved")}
        </p>
      ) : null}
      {query.error ? (
        <p className="rounded-md border border-danger bg-danger-soft px-3 py-2 text-sm text-danger">
          {query.error.includes(" ") ? query.error : t("scoring.failed")}
        </p>
      ) : null}

      <Card>
        <CardHeader title={t("scoring.rules")} />
        <CardBody>
          {rules === null ? (
            <p className="text-sm text-danger">{t("scoring.unavailable")}</p>
          ) : rules.length === 0 ? (
            <p className="max-w-prose text-sm text-ink-muted">{t("scoring.empty")}</p>
          ) : (
            <ul className="grid list-none gap-2 p-0">
              {rules.map((rule) => (
                <li
                  key={rule.id}
                  className="flex flex-wrap items-center gap-3 rounded-md border border-rule p-3 text-sm"
                >
                  <span className="font-medium">{rule.name}</span>
                  {rule.active ? null : <Pill tone="neutral">{t("scoring.off")}</Pill>}
                  {rule.kind === "threshold" ? (
                    <span className="text-ink-muted">
                      {t("scoring.atScore", { score: String(rule.thresholdScore ?? 0) })}
                    </span>
                  ) : (
                    <>
                      <span className="font-mono text-xs text-ink-muted">{rule.eventName}</span>
                      <span className="tabular-nums">
                        {rule.points >= 0 ? `+${rule.points}` : String(rule.points)}
                      </span>
                      {/* Stated decay, on the row, in words. A number with no
                          stated lifetime is the beginning of a black box. */}
                      <span className="text-ink-muted">
                        {rule.decayDays > 0
                          ? t("scoring.fadesOver", { days: String(rule.decayDays) })
                          : t("scoring.neverFades")}
                      </span>
                      {rule.maxAwards ? (
                        <span className="text-ink-muted">
                          {t("scoring.upTo", { count: String(rule.maxAwards) })}
                        </span>
                      ) : null}
                    </>
                  )}
                  {rule.advanceTo ? (
                    <Pill tone="accent">
                      {t("scoring.movesTo", { stage: t(`scoring.stage.${rule.advanceTo}`) })}
                    </Pill>
                  ) : null}
                  <form action={removeScoringRuleAction} className="ms-auto">
                    <input type="hidden" name="id" value={rule.id} />
                    <Button type="submit" variant="quiet">
                      {t("scoring.action.remove")}
                    </Button>
                  </form>
                </li>
              ))}
            </ul>
          )}
          {/* Deleting a rule leaves the points it already gave, so nobody's
              history is quietly rewritten. */}
          <p className="max-w-prose text-sm text-ink-muted">{t("scoring.removeHint")}</p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("scoring.add")} />
        <CardBody>
          <form action={saveScoringRuleAction} className="flex flex-wrap items-end gap-3">
            <label className="grid grow gap-1 text-sm">
              <span className="text-ink-muted">{t("scoring.field.name")}</span>
              <input
                name="name"
                required
                className="w-full rounded-md border border-rule bg-field px-2 py-1 text-sm"
              />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="text-ink-muted">{t("scoring.field.kind")}</span>
              <select
                name="kind"
                defaultValue="event"
                className="rounded-md border border-rule bg-field px-2 py-1 text-sm"
              >
                {SCORING_RULE_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {t(`scoring.kind.${kind}`)}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-sm">
              <span className="text-ink-muted">{t("scoring.field.event")}</span>
              <input
                name="eventName"
                list="scoring-events"
                className="rounded-md border border-rule bg-field px-2 py-1 font-mono text-sm"
              />
              {/* A suggestion list rather than a closed picker: the platform
                  emits far more than this, and a dropdown of a hundred entries
                  is a way of making a decision nobody makes. */}
              <datalist id="scoring-events">
                {SUGGESTED_EVENTS.map((event) => (
                  <option key={event} value={event} />
                ))}
              </datalist>
            </label>
            <label className="grid gap-1 text-sm">
              <span className="text-ink-muted">{t("scoring.field.points")}</span>
              <input
                type="number"
                name="points"
                defaultValue={10}
                className="w-20 rounded-md border border-rule bg-field px-2 py-1 text-sm tabular-nums"
              />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="text-ink-muted">{t("scoring.field.decayDays")}</span>
              <input
                type="number"
                name="decayDays"
                min={0}
                defaultValue={0}
                className="w-20 rounded-md border border-rule bg-field px-2 py-1 text-sm tabular-nums"
              />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="text-ink-muted">{t("scoring.field.maxAwards")}</span>
              <input
                type="number"
                name="maxAwards"
                min={1}
                className="w-20 rounded-md border border-rule bg-field px-2 py-1 text-sm tabular-nums"
              />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="text-ink-muted">{t("scoring.field.threshold")}</span>
              <input
                type="number"
                name="thresholdScore"
                className="w-20 rounded-md border border-rule bg-field px-2 py-1 text-sm tabular-nums"
              />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="text-ink-muted">{t("scoring.field.advanceTo")}</span>
              <select
                name="advanceTo"
                defaultValue=""
                className="rounded-md border border-rule bg-field px-2 py-1 text-sm"
              >
                <option value="">{t("scoring.stayPut")}</option>
                {LIFECYCLE_LADDER.map((stage) => (
                  <option key={stage} value={stage}>
                    {t(`scoring.stage.${stage}`)}
                  </option>
                ))}
              </select>
            </label>
            <Button type="submit">{t("scoring.action.add")}</Button>
          </form>
          <p className="max-w-prose text-sm text-ink-muted">{t("scoring.addHint")}</p>
        </CardBody>
      </Card>
    </div>
  );
}
