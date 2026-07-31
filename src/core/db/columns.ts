// Copyright (C) 2026 Camp Denman Society
// SPDX-License-Identifier: AGPL-3.0-only
// The timestamp columns every spine table carries (MASTER.md §2 principle 12).
//
// These exist as shared builders rather than as three lines copied into each
// table because `updated_at` was previously maintained by hand — every write
// path had to remember `set({ ..., updatedAt: sql`now()` })`, and the ones that
// forgot were invisible: the row still saved, the timestamp just quietly lied.
// A stale updated_at is not a cosmetic bug. It is what "changed since" sync,
// cache invalidation, export deltas and audit reconstruction all read.
//
// `$onUpdate` moves that obligation into the column, where a service cannot
// forget it. Drizzle applies it to both `update()` and `onConflictDoUpdate`,
// and it is a runtime concern only — drizzle-kit does not see it, so no
// migration is involved and the column definition in the database is unchanged.
//
// The value is `now()` rather than a JavaScript `new Date()` deliberately: time
// authority stays with the database, so a skewed application clock cannot write
// a timestamp that disagrees with the transaction that produced it. Postgres
// `now()` is transaction start time, so every row touched by one mutation
// carries the same instant — which is what makes it usable as a change cursor.
import { sql } from "drizzle-orm";
import { timestamp } from "drizzle-orm/pg-core";

export const createdAtColumn = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const updatedAtColumn = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => sql`now()`);
