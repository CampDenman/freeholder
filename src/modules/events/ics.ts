// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// RFC 5545 calendar export for a published event.

function fold(line: string): string {
  if (line.length <= 75) return line;
  const parts: string[] = [];
  let remaining = line;
  parts.push(remaining.slice(0, 75));
  remaining = remaining.slice(75);
  while (remaining.length) {
    parts.push(` ${remaining.slice(0, 74)}`);
    remaining = remaining.slice(74);
  }
  return parts.join("\r\n");
}

function escapeText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
}

function stamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

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
