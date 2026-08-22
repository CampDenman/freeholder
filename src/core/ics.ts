// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// RFC 5545, the parts of it this platform actually needs (MASTER.md §4.4).
//
// §4.4: "ICS everywhere: a subscribable feed per calendar for the owner, and
// an attachment on every confirmation for the customer. Two-way sync is the
// calendar adapter family (§12); **the ICS path works with no adapter at
// all**."
//
// That last clause is why this exists as text rather than as a provider call.
// An owner with no Google account, no Microsoft account and no intention of
// getting either still gets their diary on their phone, because a .ics file is
// something every calendar on earth already reads.
//
// The primitives live in core because two copies of a line-folding algorithm
// is two chances to fold at the wrong column, and the bug that produces is an
// .ics file that opens fine in the one client the author tested.

/**
 * RFC 5545 §3.1: lines are at most 75 octets, continued with a leading space.
 *
 * Measured in octets rather than characters, because the limit is about bytes
 * on the wire — an emoji in an appointment title is four of them, and a naive
 * character count produces a line a strict parser rejects. Splitting is done
 * on whole code points so a continuation never begins mid-character.
 */
export function fold(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;

  const parts: string[] = [];
  let current = "";
  let currentBytes = 0;
  let limit = 75;
  for (const character of line) {
    const size = encoder.encode(character).length;
    if (currentBytes + size > limit) {
      parts.push(current);
      current = character;
      currentBytes = size;
      // Continuations carry a leading space, which costs one of the 75.
      limit = 74;
      continue;
    }
    current += character;
    currentBytes += size;
  }
  if (current) parts.push(current);
  return parts.map((part, index) => (index === 0 ? part : ` ${part}`)).join("\r\n");
}

/** RFC 5545 §3.3.11: backslash, newline, comma and semicolon are structural. */
export function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\r\n|\n|\r/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

/**
 * The inverse of `escapeText`, for reading somebody else's feed.
 *
 * Done in one pass rather than four `replace` calls, because sequential
 * replacement un-escapes what a previous step just produced: `\\;` means a
 * literal backslash followed by a separator, and undoing `\;` first would turn
 * it into a semicolon that was never in the title.
 */
export function unescapeText(value: string): string {
  return value.replace(/\\([\\;,nN])/g, (_match, character: string) =>
    character === "n" || character === "N" ? "\n" : character,
  );
}

/** UTC, which is the only form this platform emits. Store UTC (§4.9). */
export function stamp(date: Date): string {
  return `${date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "")}`;
}

export interface IcsEvent {
  uid: string;
  startsAt: Date;
  endsAt: Date;
  summary: string;
  description?: string | null;
  location?: string | null;
  url?: string | null;
  /** `CANCELLED` tells a subscribed client to remove it rather than keep it. */
  status?: "CONFIRMED" | "CANCELLED" | "TENTATIVE";
  /** Bumped when an event changes, so a client knows which copy is newer. */
  sequence?: number;
  /** `TRANSPARENT` means "on the calendar but not blocking". */
  transparency?: "OPAQUE" | "TRANSPARENT";
}

export function renderCalendar(
  events: readonly IcsEvent[],
  options: { prodId: string; method?: "PUBLISH" | "REQUEST" | "CANCEL"; name?: string },
): string {
  const now = stamp(new Date());
  const body = events.map((event) =>
    [
      "BEGIN:VEVENT",
      `UID:${event.uid}`,
      `DTSTAMP:${now}`,
      `DTSTART:${stamp(event.startsAt)}`,
      `DTEND:${stamp(event.endsAt)}`,
      fold(`SUMMARY:${escapeText(event.summary)}`),
      event.description ? fold(`DESCRIPTION:${escapeText(event.description)}`) : "",
      event.location ? fold(`LOCATION:${escapeText(event.location)}`) : "",
      event.url ? fold(`URL:${event.url}`) : "",
      `STATUS:${event.status ?? "CONFIRMED"}`,
      `SEQUENCE:${event.sequence ?? 0}`,
      `TRANSP:${event.transparency ?? "OPAQUE"}`,
      "END:VEVENT",
    ]
      .filter(Boolean)
      .join("\r\n"),
  );

  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:${options.prodId}`,
    "CALSCALE:GREGORIAN",
    `METHOD:${options.method ?? "PUBLISH"}`,
    ...(options.name ? [fold(`X-WR-CALNAME:${escapeText(options.name)}`)] : []),
    ...body,
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}

export interface ParsedIcsEvent {
  uid: string;
  startsAt: Date;
  endsAt: Date;
  summary?: string;
  /** False for `TRANSP:TRANSPARENT` — on the calendar, not blocking. */
  busy: boolean;
  cancelled: boolean;
}

/** Undo the folding: a continuation line begins with a space or a tab. */
function unfold(text: string): string[] {
  const lines: string[] = [];
  for (const raw of text.split(/\r\n|\n|\r/)) {
    if ((raw.startsWith(" ") || raw.startsWith("\t")) && lines.length > 0) {
      lines[lines.length - 1] += raw.slice(1);
      continue;
    }
    lines.push(raw);
  }
  return lines;
}

/**
 * `20260914T090000Z`, `20260914T090000` or `20260914`.
 *
 * A floating time with no zone is read as UTC, which is a guess — but it is
 * the guess every other reader makes, and the alternative is dropping an
 * appointment that will genuinely block somebody's day.
 */
function parseMoment(value: string): { at: Date; allDay: boolean } | null {
  const trimmed = value.trim();
  const utc =
    /^(?<year>\d{4})(?<month>\d{2})(?<day>\d{2})T(?<hour>\d{2})(?<minute>\d{2})(?<second>\d{2})Z?$/.exec(
      trimmed,
    );
  if (utc?.groups) {
    const parts = utc.groups;
    return {
      at: new Date(
        Date.UTC(
          Number(parts.year),
          Number(parts.month) - 1,
          Number(parts.day),
          Number(parts.hour),
          Number(parts.minute),
          Number(parts.second),
        ),
      ),
      allDay: false,
    };
  }
  const date = /^(?<year>\d{4})(?<month>\d{2})(?<day>\d{2})$/.exec(trimmed);
  if (date?.groups) {
    const parts = date.groups;
    return {
      at: new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day))),
      allDay: true,
    };
  }
  return null;
}

/**
 * The events in an .ics feed, as busy time.
 *
 * Deliberately forgiving about everything that is not a time: a feed with a
 * property this does not understand is a feed that still says when somebody is
 * busy, and refusing the whole file over an unknown line would be choosing
 * purity over the owner's diary. Recurrence is the one real limit — an `RRULE`
 * is not expanded, and the event is taken at its first occurrence, which is
 * recorded here rather than discovered later.
 */
export function parseIcs(text: string): ParsedIcsEvent[] {
  const found: ParsedIcsEvent[] = [];
  let current: Partial<ParsedIcsEvent> & { allDay?: boolean } = {};
  let inside = false;

  for (const line of unfold(text)) {
    if (line.startsWith("BEGIN:VEVENT")) {
      inside = true;
      current = { busy: true, cancelled: false };
      continue;
    }
    if (line.startsWith("END:VEVENT")) {
      inside = false;
      if (current.uid && current.startsAt && current.endsAt) {
        found.push({
          uid: current.uid,
          startsAt: current.startsAt,
          endsAt: current.endsAt,
          summary: current.summary,
          busy: current.busy ?? true,
          cancelled: current.cancelled ?? false,
        });
      }
      continue;
    }
    if (!inside) continue;

    const separator = line.indexOf(":");
    if (separator === -1) continue;
    const rawName = line.slice(0, separator);
    const value = line.slice(separator + 1);
    const name = rawName.split(";")[0]!.toUpperCase();

    // UID is read raw, deliberately: it is a key rather than something anybody
    // reads, and `renderCalendar` writes it raw too, so leaving both ends
    // untouched is what makes a feed round-trip through its own identifiers.
    if (name === "UID") current.uid = value.trim();
    else if (name === "SUMMARY") current.summary = unescapeText(value.trim());
    else if (name === "TRANSP") current.busy = value.trim().toUpperCase() !== "TRANSPARENT";
    else if (name === "STATUS") current.cancelled = value.trim().toUpperCase() === "CANCELLED";
    else if (name === "DTSTART") {
      const moment = parseMoment(value);
      if (moment) {
        current.startsAt = moment.at;
        current.allDay = moment.allDay;
      }
    } else if (name === "DTEND") {
      const moment = parseMoment(value);
      if (moment) current.endsAt = moment.at;
    }
  }

  return found.filter((event) => event.endsAt > event.startsAt);
}
