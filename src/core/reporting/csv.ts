// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Writing a CSV somebody else's software has to read (MASTER.md §2535, C9.32).
//
// The platform already has a CSV *reader* (`core/import/csv.ts`), written by
// hand for a stated reason: the failure modes are specific and a dependency
// would hide them. Writing has its own two, and they pull in opposite
// directions, which is why the cells here are typed rather than stringly.
//
// **A text cell is an attack surface.** A spreadsheet treats a cell beginning
// `=`, `+`, `-`, `@`, tab or CR as a formula, so a customer who names their
// company `=HYPERLINK(...)` gets code executed on the accountant's machine
// when the file is opened. The defence is a leading apostrophe.
//
// **A money cell must not be defused.** Apply that same rule to `-12.34` and
// the file now carries `'-12.34`, which Excel shows as text and which
// QuickBooks and Xero reject or import as zero. A refund would silently stop
// being a refund — the exact class of quiet wrongness this whole item exists
// to avoid.
//
// So a caller says which kind of cell it is writing, once, and cannot get it
// wrong later.

/** A cell whose content came from a person, and is therefore never trusted. */
export interface TextCell {
  kind: "text";
  value: string;
}

/**
 * A cell this code produced: a number, a date, a currency code, an id.
 *
 * Quoted like everything else, but never defused — see above. Nothing that
 * originated outside the platform may be passed here.
 */
export interface DataCell {
  kind: "data";
  value: string | number;
}

export type CsvCell = TextCell | DataCell;

/** Untrusted content: a customer name, a line description, a memo. */
export function text(value: string | null | undefined): TextCell {
  return { kind: "text", value: value == null ? "" : String(value) };
}

/** Content this code generated: an amount, a date, a code, a count. */
export function data(value: string | number | null | undefined): DataCell {
  return { kind: "data", value: value == null ? "" : value };
}

const FORMULA_LEAD = /^[=+\-@\t\r\n]/;

function render(cell: CsvCell): string {
  const raw = String(cell.value);
  const body = cell.kind === "text" && FORMULA_LEAD.test(raw) ? `'${raw}` : raw;
  // Every field is quoted rather than only the ones that need it. Conditional
  // quoting is where a writer meets the address with a newline in it and
  // guesses wrong; quoting always costs two bytes a cell and cannot.
  return `"${body.replaceAll('"', '""')}"`;
}

export interface CsvFileOptions {
  /**
   * Whether to lead with a byte-order mark.
   *
   * Yes for a file a person opens in Excel, which otherwise reads UTF-8 as the
   * system codepage and turns `Café` into `CafÃ©`. No for a file an importer
   * parses, because a BOM lands inside the first header name and turns
   * `*InvoiceNo` into something the importer has never heard of.
   */
  byteOrderMark?: boolean;
}

/**
 * Header and rows as one file.
 *
 * CRLF, because that is what RFC 4180 says and what the spreadsheet on the
 * accountant's Windows machine will not argue with. A trailing newline,
 * because a file whose last line has no terminator makes some importers drop
 * the last row — and the last row is somebody's invoice.
 */
export function csvFile(
  header: readonly string[],
  rows: readonly (readonly CsvCell[])[],
  options: CsvFileOptions = {},
): string {
  for (const row of rows) {
    if (row.length !== header.length) {
      throw new Error(
        `CSV row has ${row.length} cells but the header has ${header.length}; ` +
          "a ragged file is one an importer silently misaligns.",
      );
    }
  }
  const lines = [
    header.map((name) => render(data(name))).join(","),
    ...rows.map((row) => row.map(render).join(",")),
  ];
  return `${options.byteOrderMark ? "﻿" : ""}${lines.join("\r\n")}\r\n`;
}
