// Copyright (C) 2026 Camp Denman Society
// SPDX-License-Identifier: AGPL-3.0-only
// Shared scaffolding for database-backed tests. Suites gate on `hasDatabase`
// via describe.runIf so the unit suite still runs on a machine with no
// Postgres, and truncate between tests so ordering never carries state.
import { sql } from "drizzle-orm";
import { db } from "@/core/db";
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

/** Every spine table, in dependency order. Extend when core adds tables. */
export async function truncateSpine(): Promise<void> {
  await db().execute(sql`
    truncate table
      "audit_log", "timeline_events", "contacts", "organizations",
      "sessions", "users", "module_settings", "business_profile"
    restart identity cascade
  `);
}

export { closeDb } from "@/core/db";
