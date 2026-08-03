// Copyright (C) 2026 Camp Denman Society
// SPDX-License-Identifier: AGPL-3.0-only
// Types for the schema-compatibility gate (MASTER.md §39.5).
//
// The gate itself stays plain `.mjs` so CI can run it with node and no build
// step, the way every other script here works. This exists because its
// detector is worth testing directly, and a test that imports it should not
// have to do so as `any` — the value of the gate is entirely in what it does
// and does not match.

/** One kind of statement the previous release cannot survive. */
export interface BreakingStatement {
  id:
    | "drop-table"
    | "drop-column"
    | "rename"
    | "retype-column"
    | "not-null-without-default"
    | "add-required-column";
  why: string;
}

export interface MigrationReview {
  path: string;
  /** True when the migration is safe, or its break was explained. */
  ok: boolean;
  breaking: BreakingStatement[];
  /** The text after the acknowledgement marker, when there is one. */
  reason?: string | null;
  /** The marker was present but said nothing. */
  empty?: boolean;
  /** A real break, deliberately taken and explained. */
  acknowledged?: boolean;
}

export function stripComments(sql: string): string;
export function findBreakingStatements(sql: string): BreakingStatement[];
export function acknowledgement(sql: string): { reason: string } | null;
export function reviewMigration(path: string, sql: string): MigrationReview;
