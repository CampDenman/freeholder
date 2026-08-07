// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
// Shared scaffolding for database-backed tests. Suites gate on `hasDatabase`
// via describe.runIf so the unit suite still runs on a machine with no
// Postgres, and truncate between tests so ordering never carries state.
import { is, sql } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import { db } from "@/core/db";
import manifests from "@/modules";
import type { Actor, ServiceError } from "@/core/service";

export const hasDatabase = Boolean(process.env.DATABASE_URL);

/** Narrowed so tests can read `.userId` when asserting on audit attribution. */
type UserActor = Extract<Actor, { kind: "user" }>;

export const OWNER: UserActor = {
  kind: "user",
  userId: "00000000-0000-4000-8000-000000000001",
  role: "owner",
};
export const STAFF: UserActor = {
  kind: "user",
  userId: "00000000-0000-4000-8000-000000000002",
  role: "staff",
};
export const CUSTOMER: UserActor = {
  kind: "user",
  userId: "00000000-0000-4000-8000-000000000003",
  role: "customer",
};
export const ANONYMOUS: Actor = { kind: "anonymous" };

/**
 * Await a call that must fail and hand back the ServiceError it threw. Typed
 * as ServiceError rather than a union with the success value, and it turns a
 * call that unexpectedly *succeeds* into a clear failure instead of a
 * confusing assertion about a missing property.
 */
export function failure<T>(promise: Promise<T>): Promise<ServiceError> {
  return promise.then(
    () => {
      throw new Error("expected this call to fail, but it resolved");
    },
    (error: unknown) => error as ServiceError,
  );
}

/**
 * Empty every table any installed module owns, between tests.
 *
 * Derived from the manifests rather than hand-listed, and from *all* of them
 * rather than core's barrel alone. Both of those are the same lesson learned
 * twice: a hand-list and the real set are two records of one fact, and the
 * failure is quiet — a table nobody added here leaks state into the next test
 * and surfaces as a flake in an unrelated suite. `tables` is already the
 * manifest field that answers "what does this module own" (§11), so asking it
 * means a new module is cleaned up by existing.
 *
 * `cascade` means dependency order does not need stating either.
 */
export async function truncateSpine(): Promise<void> {
  const names: string[] = [];
  for (const manifest of manifests) {
    if (!manifest.tables) continue;
    const owned: Record<string, unknown> = await manifest.tables();
    for (const value of Object.values(owned)) {
      if (is(value, PgTable)) names.push(`"${getTableConfig(value).name}"`);
    }
  }
  await db().execute(
    sql.raw(`truncate table ${names.join(", ")} restart identity cascade`),
  );
}

export { closeDb } from "@/core/db";
