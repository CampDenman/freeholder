// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The visitor's own record of what they have been shown (C9.30).
//
// ── Why this exists at all ────────────────────────────────────────────────
//
// A frequency cap has to survive the tab closing, or it is not a cap. The
// obvious place to keep the count is the server, keyed on the first-party
// visitor id — and that is exactly what `popup_events` does. But `fh_v` is an
// *identifier*, and `modules/analytics/visitor.ts` refuses to set one without a
// durable consent choice. So on a site running opt-in analytics, most visitors
// have no key, and a cap that depends on one is a cap that does not exist for
// the people most likely to resent a popup.
//
// This is the other half. It stores no identifier: one row per popup saying
// "shown twice since Tuesday, closed on Wednesday". It cannot be joined to
// anything, it is meaningless outside this browser, and it is not an
// alternative route to analytics — it answers one question, which is whether
// this browser has had enough of this popup. That is the narrowest thing a
// cookie can be and still make the promise the cap makes.
//
// The honest limit, stated rather than glossed: a visitor who accepts no
// cookies at all and is not signed in cannot be remembered by anything, and
// will see the popup on each page view. That is the floor of every frequency
// cap on the web; the difference is whether it is written down.
//
// ── Why an encoding rather than JSON ──────────────────────────────────────
//
// The value goes through a `Set-Cookie` header, so it wants to be short and
// free of characters that need escaping. Epoch minutes rather than
// milliseconds, because nothing here needs to be precise to the second and it
// saves three characters on every field.

/** Not an identifier: a per-popup tally, readable only by this site. */
export const POPUP_TALLY_COOKIE = "fh_pop";

/**
 * A year. Long enough that "do not show this again for a month" survives, and
 * short enough that a browser nobody has used since forgets rather than keeps.
 */
export const POPUP_TALLY_MAX_AGE = 60 * 60 * 24 * 365;

/**
 * How many popups a browser remembers.
 *
 * Bounded because a cookie is sent on every request and an unbounded one is a
 * performance bug that arrives quietly. Eight is more than any instance should
 * have live at once; the least recently touched entry is dropped first, which
 * is the one whose cap matters least.
 */
export const POPUP_TALLY_LIMIT = 8;

export interface TallyEntry {
  popupId: string;
  /** Impressions inside the current window. */
  seen: number;
  /** When the current window opened. */
  windowStartedAt: Date;
  dismissedAt: Date | null;
  capturedAt: Date | null;
}

export type Tally = readonly TallyEntry[];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function toMinutes(date: Date): number {
  return Math.floor(date.getTime() / 60_000);
}

function fromMinutes(value: number): Date {
  return new Date(value * 60_000);
}

function field(raw: string | undefined): number | null {
  if (!raw || raw === "0") return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

/**
 * Read the cookie.
 *
 * Every failure mode returns fewer entries rather than throwing. This value
 * arrives from the browser and a visitor may edit it, so a malformed entry is
 * an ordinary event — and the worst a forged one can do is show its owner a
 * popup they had already dismissed, which is not a security boundary worth
 * signing a cookie over.
 */
export function parseTally(value: string | null | undefined): TallyEntry[] {
  if (!value) return [];
  const entries: TallyEntry[] = [];
  for (const chunk of value.split("~").slice(0, POPUP_TALLY_LIMIT)) {
    const parts = chunk.split(".");
    const popupId = parts[0];
    if (!popupId || !UUID.test(popupId)) continue;
    const seen = Number.parseInt(parts[1] ?? "", 10);
    const started = field(parts[2]);
    if (!Number.isSafeInteger(seen) || seen < 0 || started === null) continue;
    entries.push({
      popupId: popupId.toLowerCase(),
      seen,
      windowStartedAt: fromMinutes(started),
      dismissedAt: field(parts[3]) === null ? null : fromMinutes(field(parts[3])!),
      capturedAt: field(parts[4]) === null ? null : fromMinutes(field(parts[4])!),
    });
  }
  return entries;
}

export function serializeTally(tally: Tally): string {
  return tally
    .slice(0, POPUP_TALLY_LIMIT)
    .map((entry) =>
      [
        entry.popupId,
        entry.seen,
        toMinutes(entry.windowStartedAt),
        entry.dismissedAt ? toMinutes(entry.dismissedAt) : 0,
        entry.capturedAt ? toMinutes(entry.capturedAt) : 0,
      ].join("."),
    )
    .join("~");
}

/** The entry for one popup, or an empty one. */
export function entryFor(tally: Tally, popupId: string): TallyEntry | undefined {
  return tally.find((entry) => entry.popupId === popupId);
}

function replace(tally: Tally, entry: TallyEntry): TallyEntry[] {
  // Newest first, so the eviction at `POPUP_TALLY_LIMIT` drops the popup this
  // browser has heard from least recently rather than an arbitrary one.
  return [entry, ...tally.filter((each) => each.popupId !== entry.popupId)].slice(
    0,
    POPUP_TALLY_LIMIT,
  );
}

/**
 * Count one impression.
 *
 * A window that has run out starts again at one rather than continuing to
 * climb — the same rule `withinFrequencyCap` reads, applied at the moment the
 * count is written so the two cannot drift apart.
 */
export function recordShownInTally(
  tally: Tally,
  popupId: string,
  periodHours: number,
  now: Date,
): TallyEntry[] {
  const existing = entryFor(tally, popupId);
  const expired =
    !existing ||
    now.getTime() >= existing.windowStartedAt.getTime() + periodHours * 3_600_000;
  return replace(tally, {
    popupId,
    seen: expired ? 1 : existing.seen + 1,
    windowStartedAt: expired ? now : existing.windowStartedAt,
    dismissedAt: existing?.dismissedAt ?? null,
    capturedAt: existing?.capturedAt ?? null,
  });
}

export function recordDismissedInTally(
  tally: Tally,
  popupId: string,
  now: Date,
): TallyEntry[] {
  const existing = entryFor(tally, popupId);
  return replace(tally, {
    popupId,
    seen: existing?.seen ?? 1,
    windowStartedAt: existing?.windowStartedAt ?? now,
    dismissedAt: now,
    capturedAt: existing?.capturedAt ?? null,
  });
}

export function recordCapturedInTally(
  tally: Tally,
  popupId: string,
  now: Date,
): TallyEntry[] {
  const existing = entryFor(tally, popupId);
  return replace(tally, {
    popupId,
    seen: existing?.seen ?? 1,
    windowStartedAt: existing?.windowStartedAt ?? now,
    dismissedAt: existing?.dismissedAt ?? null,
    capturedAt: now,
  });
}
