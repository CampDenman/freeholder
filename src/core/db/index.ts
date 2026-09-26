// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The one sacred database (MASTER.md §2, principle 12). Lazy singleton so
// importing this module never connects — only use does.
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { databasePoolMax, databaseUrl } from "@/core/env";

function connect() {
  const conn = postgres(databaseUrl(), {
    // Bounded so two instances fit in a small managed database during a
    // rolling deploy: this process holds one pool per module graph, and the
    // platform runs the new instance beside the old one.
    max: databasePoolMax(),
    // Readiness must fail promptly while liveness remains available. A dead
    // database route otherwise occupies the pool and outlives the platform's
    // five-second health-check budget.
    connect_timeout: 3,
    onnotice: () => {},
  });
  return { conn, orm: drizzle(conn) };
}

// Inferred from the call, not from the overloaded `drizzle` signature, so `Tx`
// in the service layer stays the concrete transaction type.
export type Database = ReturnType<typeof connect>["orm"];

let open: ReturnType<typeof connect> | undefined;

export function db(): Database {
  open ??= connect();
  return open.orm;
}

/**
 * Release the pool. The long-running server never needs this; one-shot scripts
 * and test runs do, or the process hangs on an idle connection.
 */
export async function closeDb(): Promise<void> {
  const previous = open;
  open = undefined;
  await previous?.conn.end();
}

const UNIQUE_VIOLATION = "23505";
const FOREIGN_KEY_VIOLATION = "23503";

/**
 * True when this error — or anything it wraps — is a Postgres unique-constraint
 * violation, optionally for one named index.
 *
 * Drizzle raises a `DrizzleQueryError` and hangs the driver error off `.cause`,
 * so `error.code` on what you actually catch is undefined. Checking the top
 * level alone silently never matches, which looks exactly like "the constraint
 * isn't there" — walk the chain instead.
 */
export function isUniqueViolation(
  error: unknown,
  constraint?: string,
): boolean {
  let current: unknown = error;
  for (let depth = 0; current && depth < 5; depth += 1) {
    const candidate = current as {
      code?: string;
      constraint_name?: string;
      cause?: unknown;
    };
    if (candidate.code === UNIQUE_VIOLATION) {
      return !constraint || candidate.constraint_name === constraint;
    }
    current = candidate.cause;
  }
  return false;
}

/**
 * True when this error — or anything it wraps — is a Postgres
 * foreign-key violation. A delete refused this way means a row elsewhere
 * still points at the one being removed; services translate that into the
 * conflict sentence a person can act on rather than the driver page.
 */
export function isForeignKeyViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; current && depth < 5; depth += 1) {
    const candidate = current as { code?: unknown; cause?: unknown };
    if (candidate.code === FOREIGN_KEY_VIOLATION) return true;
    current = candidate.cause;
  }
  return false;
}
