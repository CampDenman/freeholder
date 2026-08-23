// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Reading a spreadsheet somebody exported (C7.07).
//
// Written rather than pulled in, because the failure modes here are specific
// and a dependency would hide them: a business's contact list is exactly the
// file most likely to contain a company name with a comma in it, an address
// with a newline in it, and a leading byte-order mark from Excel. Each of those
// silently corrupts an import if the parser is a `split(",")`, and the damage
// lands in the contact spine.
//
// RFC 4180 with the two deviations every real file has: bare CR or LF both end
// a row, and a field may contain either inside quotes.

/** What a delimiter can be. Semicolons are what a French Excel exports. */
export const DELIMITERS = [",", ";", "\t", "|"] as const;

export type Delimiter = (typeof DELIMITERS)[number];

/**
 * Guess the delimiter from the header line.
 *
 * The one that splits the first line into the most fields wins. Counting on the
 * header rather than the whole file keeps a comma inside somebody's address
 * from voting, and a header line is the one row that is nearly always simple.
 */
export function guessDelimiter(text: string): Delimiter {
  const firstLine = text.split(/\r\n|\r|\n/, 1)[0] ?? "";
  let best: Delimiter = ",";
  let bestCount = 0;
  for (const candidate of DELIMITERS) {
    const count = parseRow(firstLine, candidate).length;
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }
  return best;
}

/** One line, for delimiter guessing. Quotes still apply. */
function parseRow(line: string, delimiter: Delimiter): string[] {
  return parseCsv(line, delimiter)[0] ?? [];
}

/**
 * The whole file, as rows of fields.
 *
 * A hand-written state machine rather than a regex, because quoted fields can
 * contain the delimiter, the line ending, and doubled quotes — and a regex that
 * handles all three is a regex nobody can fix six months later.
 */
export function parseCsv(text: string, delimiter: Delimiter = ","): string[][] {
  // Excel writes a byte-order mark. Left in place it becomes part of the first
  // header, and "﻿email" then matches nothing.
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let index = 0;

  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    // A trailing newline should not produce a row of one empty field.
    if (row.length > 1 || row[0] !== "") rows.push(row);
    row = [];
  };

  while (index < input.length) {
    const char = input[index]!;

    if (quoted) {
      if (char === '"') {
        // A doubled quote inside a quoted field is one literal quote.
        if (input[index + 1] === '"') {
          field += '"';
          index += 2;
          continue;
        }
        quoted = false;
        index += 1;
        continue;
      }
      field += char;
      index += 1;
      continue;
    }

    if (char === '"' && field === "") {
      quoted = true;
      index += 1;
      continue;
    }
    if (char === delimiter) {
      endField();
      index += 1;
      continue;
    }
    if (char === "\r" || char === "\n") {
      endRow();
      // Windows line endings are two characters and must not make a blank row.
      index += char === "\r" && input[index + 1] === "\n" ? 2 : 1;
      continue;
    }
    field += char;
    index += 1;
  }

  if (field !== "" || row.length > 0) endRow();
  return rows;
}

/**
 * The contact fields a column can be mapped to.
 *
 * Deliberately small. An import that can set anything is an import that can set
 * `lifecycle_stage` to a value the spine does not have, and the way people
 * discover that is a column of broken records. Everything else a business puts
 * in a spreadsheet goes to a custom field or a tag, which are the two places
 * built to hold whatever somebody has.
 */
export const IMPORTABLE_FIELDS = [
  "email",
  "name",
  "phone",
  "country",
  "preferredLocale",
  "timezone",
  "tags",
  "source",
  "custom",
  "ignore",
] as const;

export type ImportableField = (typeof IMPORTABLE_FIELDS)[number];

/**
 * What each header probably means.
 *
 * A guess an owner can correct, never a decision. The mapping step exists
 * because guessing is what every importer does badly, and the cost of getting
 * it wrong here is a contact record with somebody's phone number in the name
 * column — which then propagates through every email the business sends.
 */
const HINTS: Array<[RegExp, ImportableField]> = [
  [/^e[\s_-]?mail|email[\s_-]?address$/i, "email"],
  [/^(full[\s_-]?)?name$|^contact$|^customer$/i, "name"],
  [/phone|mobile|tel|cell/i, "phone"],
  [/country/i, "country"],
  [/locale|language/i, "preferredLocale"],
  [/time[\s_-]?zone/i, "timezone"],
  [/tags?|labels?|groups?/i, "tags"],
  [/source|origin|referr?er/i, "source"],
];

export function guessField(header: string): ImportableField {
  const cleaned = header.trim();
  if (cleaned === "") return "ignore";
  for (const [pattern, field] of HINTS) {
    if (pattern.test(cleaned)) return field;
  }
  // Unknown but present: a custom field keeps it rather than throwing it away,
  // and the owner can still say "ignore" at the mapping step.
  return "custom";
}

/**
 * A first mapping for a header row, one entry per column.
 *
 * The first column that looks like an email wins; a second is left as a custom
 * field rather than quietly overwriting the first, because a file with
 * "email" and "email_2" has two facts and the importer must not choose between
 * them.
 */
export function guessMapping(headers: string[]): ImportableField[] {
  const used = new Set<ImportableField>();
  return headers.map((header) => {
    const guess = guessField(header);
    if (guess === "custom" || guess === "ignore" || guess === "tags") return guess;
    if (used.has(guess)) return "custom";
    used.add(guess);
    return guess;
  });
}
