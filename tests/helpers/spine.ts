// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Shared scaffolding for database-backed tests. Suites gate on `hasDatabase`
// via describe.runIf so the unit suite still runs on a machine with no
// Postgres, and truncate between tests so ordering never carries state.
import { is, sql } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import { db } from "@/core/db";
import manifests from "@/modules";
import type { Actor, ServiceError } from "@/core/service";
import { seedDefaultRoles } from "@/core/roles/defaults";
import { seedCoreGuidanceFlows } from "@/core/guidance/definitions";
import { seedReviewedBuiltinPlugins } from "./plugin-consent";

export const hasDatabase = Boolean(process.env.DATABASE_URL);

/** Narrowed so tests can read `.userId` when asserting on audit attribution. */
type UserActor = Extract<Actor, { kind: "user" }>;

export const OWNER: UserActor = {
  kind: "user",
  userId: "00000000-0000-4000-8000-000000000001",
  role: "owner",
  grants: [{ module: "*", access: "manage" }],
};
export const STAFF: UserActor = {
  kind: "user",
  userId: "00000000-0000-4000-8000-000000000002",
  role: "staff",
  grants: [{ module: "*", access: "manage" }],
};
export const CUSTOMER: UserActor = {
  kind: "user",
  userId: "00000000-0000-4000-8000-000000000003",
  role: "customer",
  grants: [],
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
  await db().transaction(async (tx) => {
    // The database must abandon a blocked reset before Vitest abandons the
    // hook. Otherwise the uncancelled query can complete later and race the
    // next test's setup, turning one infrastructure stall into misleading
    // duplicate-key failures. Keep the reset and its required defaults atomic
    // so another connection can observe either the old fixture or the new one,
    // never the empty interval between them.
    await tx.execute(sql.raw("set local lock_timeout = '10s'"));
    await tx.execute(sql.raw("set local statement_timeout = '25s'"));
    await tx.execute(
      sql.raw(`truncate table ${names.join(", ")} restart identity cascade`),
    );
    // The job queue lives in another schema, so the truncate above never
    // reaches it and work queued by one test survives into every later one.
    // Measured 2026-11-18: 45 rows after three money suites, 60 after four,
    // all `invoicing.reconcileOriginalMerchantFee` and
    // `reconcileOriginalRefundCurrentState`. Those suites keep the job runtime
    // running for the whole file, so under load a worker can claim a stale
    // money job inside a test and write to the tables that test is certifying
    // -- which is what the re-read guard in
    // controlled-cash-application-evaluation.ts then correctly refuses.
    //
    // DELETE, not TRUNCATE: a live worker polls this table, and ACCESS
    // EXCLUSIVE against it is what tests/helpers/deployment.ts avoids by doing
    // its own clear outside this transaction. Guarded by to_regclass because a
    // suite that never starts the runtime has no pgboss schema at all. Only
    // work queued BEFORE this test exists here; anything the test itself
    // queues is created afterwards and is untouched.
    await tx.execute(sql.raw(
      `do $$ begin if to_regclass('pgboss.job') is not null then delete from pgboss.job; end if; end $$`,
    ));
    await seedDefaultRoles(tx);
    await seedCoreGuidanceFlows(tx);
    await seedReviewedBuiltinPlugins(tx, `user:${OWNER.userId}`);
  });
}

export { closeDb } from "@/core/db";
