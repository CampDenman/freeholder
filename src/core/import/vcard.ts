// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// A deliberately small, bounded vCard reader for the fields C7.16 permits.
// Unknown properties are ignored rather than retained as an accidental data
// lake. Folded lines and common escaped text are handled; malformed cards
// become visible skipped/error rows in the ordinary import preview.

export interface VCardContact {
  name: string;
  email: string;
  phone: string;
}

function unfold(value: string): string[] {
  const physical = value.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split("\n");
  const logical: string[] = [];
  for (const line of physical) {
    if (/^[ \t]/.test(line) && logical.length > 0) {
      logical[logical.length - 1] += line.slice(1);
    } else {
      logical.push(line);
    }
  }
  return logical;
}

function text(value: string): string {
  return value
    .replace(/\\n/gi, " ")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\")
    .trim();
}

function first(values: string[]): string {
  return values.find(Boolean) ?? "";
}

export function parseVCard(value: string): VCardContact[] {
  const contacts: VCardContact[] = [];
  let current: { fn: string[]; n: string[]; email: string[]; tel: string[] } | null = null;
  for (const raw of unfold(value)) {
    const line = raw.trimEnd();
    if (line.toUpperCase() === "BEGIN:VCARD") {
      current = { fn: [], n: [], email: [], tel: [] };
      continue;
    }
    if (line.toUpperCase() === "END:VCARD") {
      if (current) {
        const structured = first(current.n)
          .split(";")
          .map(text)
          .filter(Boolean)
          .reverse()
          .join(" ");
        contacts.push({
          name: first(current.fn) || structured,
          email: first(current.email).toLowerCase(),
          phone: first(current.tel),
        });
      }
      current = null;
      continue;
    }
    if (!current) continue;
    const colon = line.indexOf(":");
    if (colon < 1) continue;
    const property = line.slice(0, colon).split(";", 1)[0]!.toUpperCase();
    const value = text(line.slice(colon + 1)).slice(0, 2_000);
    if (property === "FN") current.fn.push(value);
    else if (property === "N") current.n.push(value);
    else if (property === "EMAIL") current.email.push(value);
    else if (property === "TEL") current.tel.push(value);
  }
  return contacts;
}
