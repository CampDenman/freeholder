// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Why this person is the number they are (C7.05, MASTER.md §4.14).
//
// §4.14: "An owner must be able to read why someone is a 40." That sentence is
// this component. The total is not fetched separately from the reasons — the
// rows listed here *are* the total, each rounded on its own so the arithmetic
// on screen adds up — and there is no path that produces a score any other way.
import { Button, Card, CardBody, CardHeader, Pill } from "@/ui/primitives";
import { formatDateTime } from "@/core/i18n";
import { explainScore } from "@/core/scoring/service";
import type { Actor } from "@/core/service";
import { getT } from "../../i18n";
import { domainOrNull } from "../read-helpers";
import { awardPointsAction } from "../scoring-actions";

export async function ScorePanel({
  actor,
  contactId,
  locale,
  timezone,
}: {
  actor: Actor;
  contactId: string;
  locale: string;
  timezone: string;
}) {
  const [t, explained] = await Promise.all([
    getT(),
    domainOrNull(explainScore.call({ contactId }, actor)),
  ]);

  return (
    <Card>
      <CardHeader title={t("scoring.panel.title")} />
      <CardBody>
        {explained === null ? (
          <p className="text-sm text-danger">{t("scoring.unavailable")}</p>
        ) : (
          <>
            <p className="text-2xl font-bold tabular-nums">{explained.score}</p>
            {explained.awards.length === 0 ? (
              <p className="max-w-prose text-sm text-ink-muted">{t("scoring.panel.empty")}</p>
            ) : (
              <ul className="grid list-none gap-1 p-0">
                {explained.awards.map((award) => (
                  <li
                    key={award.id}
                    className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-rule py-1.5 text-sm last:border-b-0"
                  >
                    <span className="w-10 font-medium tabular-nums">
                      {award.remaining >= 0 ? `+${award.remaining}` : String(award.remaining)}
                    </span>
                    <span>{award.ruleName}</span>
                    {/* What it was worth and what is left of it, so a faded
                        award reads as faded rather than as a smaller rule. */}
                    {award.remaining !== award.points ? (
                      <Pill tone="neutral">
                        {t("scoring.panel.faded", {
                          points: String(award.points),
                          days: String(award.daysLeft ?? 0),
                        })}
                      </Pill>
                    ) : null}
                    <time
                      dateTime={award.occurredAt.toISOString()}
                      className="ms-auto font-mono text-xs text-ink-muted tabular-nums"
                    >
                      {formatDateTime(award.occurredAt, timezone, locale)}
                    </time>
                  </li>
                ))}
              </ul>
            )}
            {/* By hand, on the record: without this an owner nudges one person
                by editing a rule, which changes it for everybody. */}
            <form action={awardPointsAction} className="flex flex-wrap items-end gap-3">
              <input type="hidden" name="contactId" value={contactId} />
              <label className="grid grow gap-1 text-sm">
                <span className="text-ink-muted">{t("scoring.panel.reason")}</span>
                <input
                  name="reason"
                  required
                  className="w-full rounded-md border border-rule bg-field px-2 py-1 text-sm"
                />
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
              <Button type="submit" variant="quiet">
                {t("scoring.panel.give")}
              </Button>
            </form>
          </>
        )}
      </CardBody>
    </Card>
  );
}
