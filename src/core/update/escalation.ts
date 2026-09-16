// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The security escalation (MASTER.md §39.10, C10.22).
//
// §39.10, on the fourth surface: "a security release outstanding beyond a set
// period escalates to a notification, because silence must not be
// indistinguishable from safety."
//
// That last clause is the whole design. Every other part of the updater is
// something an owner has to go and look at — a screen, a CLI, a tool an agent
// calls. This is the one part that comes and finds them, and it exists because
// the failure mode of an updater is not a wrong answer, it is nobody asking
// the question for three months.
import { compareVersions, type MissingRelease } from "./fork";

/** How long a scored release may sit unapplied before it is worth interrupting for. */
export const ESCALATION_HOURS = { critical: 24, high: 48, medium: 96, low: 168 } as const;

export type EscalationBand = keyof typeof ESCALATION_HOURS;

export function bandFor(cvss: number): EscalationBand {
  if (cvss >= 9) return "critical";
  if (cvss >= 7) return "high";
  if (cvss >= 4) return "medium";
  return "low";
}

export interface EscalationDecision {
  escalate: boolean;
  /** The release that triggered it — the worst one that is also overdue. */
  release: MissingRelease | null;
  band: EscalationBand | null;
  hoursOutstanding: number;
  /** Stable across repeats within one window, so a daily job does not nag. */
  idempotencyKey: string | null;
  reason: string;
}

const NOT_ESCALATING = (reason: string): EscalationDecision => ({
  escalate: false,
  release: null,
  band: null,
  hoursOutstanding: 0,
  idempotencyKey: null,
  reason,
});

/**
 * Decide whether to interrupt the owner, and about which release.
 *
 * Severity sets the clock. A CVSS 9.8 that has been sitting for a day is worth
 * an interruption; a 4.2 that has been sitting for a day is not, and treating
 * them the same is how an owner learns to archive these unread — at which
 * point the escalation has made things worse than silence, not better.
 *
 * The key is bucketed by day rather than by instant so a job that runs every
 * few hours escalates once per day at most. It carries the version, so a
 * *newer* security release escalates on its own merits instead of being
 * swallowed by an earlier one's dedupe.
 */
export function decideEscalation(input: {
  missingSecurity: readonly MissingRelease[];
  now: Date;
  /** Set when the owner has deliberately paused updates. */
  paused?: boolean;
  hoursByBand?: Record<EscalationBand, number>;
}): EscalationDecision {
  if (input.missingSecurity.length === 0) {
    return NOT_ESCALATING("No security release is outstanding.");
  }
  // A pause is a decision the owner made, not a reason to stop telling them.
  // §39.6 lets them turn automatic applying off; it does not let the platform
  // stop saying they are exposed, because that is the sentence that made
  // pausing a safe thing to offer.
  const thresholds = input.hoursByBand ?? ESCALATION_HOURS;

  const overdue = input.missingSecurity
    .filter((release) => release.cvss !== null)
    .map((release) => {
      const band = bandFor(release.cvss!);
      const hours =
        (input.now.getTime() - new Date(release.publishedAt).getTime()) / 3_600_000;
      return { release, band, hours, due: hours >= thresholds[band] };
    })
    .filter((entry) => entry.due);

  if (overdue.length === 0) {
    return NOT_ESCALATING(
      "A security release is outstanding but has not been outstanding long enough for its severity.",
    );
  }

  // Worst score first; ties broken by the newer version, so the sentence names
  // the release an owner should act on rather than the oldest one on the list.
  overdue.sort(
    (a, b) =>
      (b.release.cvss ?? 0) - (a.release.cvss ?? 0) ||
      (compareVersions(b.release.version, a.release.version) ?? 0),
  );
  const worst = overdue[0]!;
  const day = input.now.toISOString().slice(0, 10);
  return {
    escalate: true,
    release: worst.release,
    band: worst.band,
    hoursOutstanding: Math.floor(worst.hours),
    idempotencyKey: `update-security:${worst.release.version}:${day}`,
    reason: input.paused
      ? `Outstanding for ${Math.floor(worst.hours)}h while automatic updates are paused.`
      : `Outstanding for ${Math.floor(worst.hours)}h.`,
  };
}

/** The sentence the notification carries. Same grammar as the status line. */
export function escalationMessage(decision: EscalationDecision): {
  title: string;
  body: string;
} {
  const release = decision.release!;
  const days = Math.floor(decision.hoursOutstanding / 24);
  const outstanding =
    days >= 1
      ? `${days} day${days === 1 ? "" : "s"}`
      : `${decision.hoursOutstanding} hour${decision.hoursOutstanding === 1 ? "" : "s"}`;
  return {
    title: `Security update ${release.version} — CVSS ${release.cvss}`,
    body:
      `This instance has been running without security release ${release.version} for ${outstanding}. ` +
      `${decision.reason} Apply it from Updates, or run \`freeholder update --apply\`.`,
  };
}
