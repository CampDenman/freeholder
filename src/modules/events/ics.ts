// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// RFC 5545 calendar export for a published event.
//
// The folding, escaping and timestamp rules moved to `@/core/ics` when
// scheduling needed them too (C6.06). Two copies of a line-folding algorithm
// is two chances to fold at the wrong column, and the bug that produces is a
// file which opens fine in the one client the author happened to test.
import { escapeText, fold, stamp } from "@/core/ics";

export function renderEventIcs(input: {
  uid: string;
  name: string;
  description?: string | null;
  url: string;
  venue?: string | null;
  sessions: Array<{ id: string; startsAt: Date; endsAt: Date }>;
}): string {
  const now = stamp(new Date());
  const events = input.sessions.map((session) =>
    [
      "BEGIN:VEVENT",
      `UID:${session.id}@freeholder`,
      `DTSTAMP:${now}`,
      `DTSTART:${stamp(session.startsAt)}`,
      `DTEND:${stamp(session.endsAt)}`,
      fold(`SUMMARY:${escapeText(input.name)}`),
      input.description ? fold(`DESCRIPTION:${escapeText(input.description)}`) : "",
      input.venue ? fold(`LOCATION:${escapeText(input.venue)}`) : "",
      fold(`URL:${input.url}`),
      "END:VEVENT",
    ]
      .filter(Boolean)
      .join("\r\n"),
  );

  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Freeholder//Events//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    ...events,
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}
