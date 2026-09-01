// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Whether this popup may interrupt this visitor, here, now (C9.30, §36).
//
// Pure functions over plain values, for the same reason `ads/targeting.ts` is:
// the decision is the part an owner has to be able to explain ("why did that
// keep appearing?"), and a decision assembled inline in a query is one nobody
// can test a case against. Everything here can be answered with a unit test
// and no database.
//
// Two of these encode a rule about *restraint* rather than about matching, and
// they are the ones worth reading twice. `withinFrequencyCap` takes the count
// as an argument because whose job it is to remember is a separate question
// from what the limit means. `suppressedAfterDismissal` exists because closing
// a popup is an answer, and a platform that treats it as a pause rather than
// an answer is the reason people hate popups.
//
// The path language is not imported from `ads`: an instance that runs a
// newsletter popup should not have to install a publisher's ad module to get a
// glob, and hoisting one twelve-line matcher into core to serve two callers
// would buy a shared bug rather than a shared abstraction.

/** Everything the decision needs to know about the request. */
export interface PopupContext {
  /** The public path, already stripped of any locale prefix. */
  path: string;
  locale: string;
}

/** What one visitor has already done with one popup. */
export interface PopupHistory {
  /** How many times it has been shown inside the current cap window. */
  seen: number;
  /** When that window opened. Null when it has never been shown. */
  windowStartedAt: Date | null;
  dismissedAt: Date | null;
  capturedAt: Date | null;
}

export const NO_HISTORY: PopupHistory = {
  seen: 0,
  windowStartedAt: null,
  dismissedAt: null,
  capturedAt: null,
};

/**
 * A pattern language small enough to explain in one line.
 *
 * `*` matches within a path segment, `**` matches across them. Deliberately
 * not a regular expression: an owner types these into a form, and a targeting
 * rule that can hang the server is not a feature.
 */
export function pathMatches(pattern: string, path: string): boolean {
  const escaped = pattern
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, " ")
    .replace(/\*/g, "[^/]*")
    .replace(/ /g, ".*");
  return new RegExp(`^${escaped}$`).test(path);
}

/**
 * Empty means anywhere.
 *
 * The alternative — empty means nowhere — turns a half-filled form into a
 * popup that silently never appears, and the owner's first symptom is a
 * campaign that produced nothing with no error anywhere to explain it.
 */
export function matchesPaths(patterns: string[], path: string): boolean {
  if (patterns.length === 0) return true;
  return patterns.some((pattern) => pathMatches(pattern, path));
}

/** Empty means any language the site publishes. */
export function matchesLocale(locales: string[], locale: string): boolean {
  if (locales.length === 0) return true;
  return locales.includes(locale);
}

/** The popup's own scheduled window. Absent ends mean it has not been given one. */
export function withinFlight(
  startsAt: Date | null,
  endsAt: Date | null,
  now: Date,
): boolean {
  if (startsAt && now < startsAt) return false;
  if (endsAt && now > endsAt) return false;
  return true;
}

/**
 * Has this visitor already seen it enough times?
 *
 * The count is supplied rather than looked up, because *where the count lives*
 * is the interesting question and it has two answers depending on whether the
 * visitor carries a durable identifier (see `service.ts` and `tally.ts`). The
 * rule belongs here, where it can be tested against a case without either.
 *
 * A window that has expired is a fresh window: the visitor saw it three times
 * last week, the cap is three a week, and this week they have seen it none.
 * Getting that wrong in the other direction — treating the count as lifetime —
 * is how a "3 per week" cap silently becomes "3, ever".
 */
export function withinFrequencyCap(
  cap: number | null,
  periodHours: number,
  history: PopupHistory,
  now: Date,
): boolean {
  if (cap === null) return true;
  if (!history.windowStartedAt) return true;
  const windowEnds = history.windowStartedAt.getTime() + periodHours * 3_600_000;
  if (now.getTime() >= windowEnds) return true;
  return history.seen < cap;
}

/**
 * Closing a popup is an answer, and this is how long it stands for.
 *
 * Zero hours means the owner has deliberately said "ask again straight away",
 * which is a choice they are allowed to make and which the admin spells out.
 */
export function suppressedAfterDismissal(
  dismissedAt: Date | null,
  suppressHours: number,
  now: Date,
): boolean {
  if (!dismissedAt) return false;
  if (suppressHours <= 0) return false;
  return now.getTime() < dismissedAt.getTime() + suppressHours * 3_600_000;
}

/** Asking a subscriber to subscribe is the classic popup insult. */
export function suppressedAfterCapture(
  capturedAt: Date | null,
  stopAfterCapture: boolean,
): boolean {
  return stopAfterCapture && capturedAt !== null;
}

/** The complete "may this be shown" rule, minus the segment (which needs a query). */
export function eligibleForVisitor(
  popup: {
    pathPatterns: string[];
    locales: string[];
    startsAt: Date | null;
    endsAt: Date | null;
    frequencyCap: number | null;
    frequencyPeriodHours: number;
    dismissSuppressHours: number;
    stopAfterCapture: boolean;
  },
  ctx: PopupContext,
  history: PopupHistory,
  now: Date,
): boolean {
  if (!withinFlight(popup.startsAt, popup.endsAt, now)) return false;
  if (!matchesPaths(popup.pathPatterns, ctx.path)) return false;
  if (!matchesLocale(popup.locales, ctx.locale)) return false;
  if (suppressedAfterCapture(history.capturedAt, popup.stopAfterCapture)) return false;
  if (suppressedAfterDismissal(history.dismissedAt, popup.dismissSuppressHours, now)) {
    return false;
  }
  return withinFrequencyCap(
    popup.frequencyCap,
    popup.frequencyPeriodHours,
    history,
    now,
  );
}

/**
 * Every record of this visitor gets a veto.
 *
 * A visitor may be remembered twice — once in `popup_events` against a durable
 * identifier, once in their own browser's tally — and neither store is
 * guaranteed complete. The server ledger has nothing for anyone who declined
 * analytics identifiers; the browser tally has nothing for somebody who
 * cleared their cookies or arrived on a second device.
 *
 * The tempting move is to merge them into one history and evaluate that once.
 * It is wrong, and quietly: the largest count and the most recent window come
 * from different stores, so pairing them counts impressions from a window that
 * has already expired. Evaluating each history against **its own** window and
 * requiring all of them to allow gives the same conservatism with none of the
 * arithmetic — and conservatism is the right side to err on here. The cost of
 * showing a popup once too rarely is one missed impression; the cost of
 * showing it once too often is a visitor deciding the site is hostile.
 */
export function eligibleForEveryHistory(
  popup: Parameters<typeof eligibleForVisitor>[0],
  ctx: PopupContext,
  histories: readonly PopupHistory[],
  now: Date,
): boolean {
  const all = histories.length > 0 ? histories : [NO_HISTORY];
  return all.every((history) => eligibleForVisitor(popup, ctx, history, now));
}
