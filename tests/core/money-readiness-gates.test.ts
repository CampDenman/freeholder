// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C12.38/C11.08: every installed money readiness gate must be TRUE on a
// migrated database.
//
// This exists because migration 0110 turned one of them permanently false and
// nothing noticed. These gates are conjunctions that pin the body hash of other
// SQL functions, so any migration that rewrites a pinned function without
// re-pinning its dependents silently switches a gate off. The consequence is
// not a failed migration: `atomic-credit-fee-partition.ts` and
// `atomic-credit-invoice-disposition.ts` refuse at runtime, and two partition
// functions RETURN with no rows rather than raise. Fail-closed, invisible, and
// permanent.
//
// `tests/core/merchant-fee-xid-epoch87.test.ts` already pins these hashes by
// reading the migration TEXT, which is how the breakage passed review: the
// pinned literals were all consistent on paper. Nothing evaluated a gate
// against a real database. This does.
//
// Deliberately enumerated from pg_proc rather than hard-coded, so a gate added
// by a future migration is covered without anyone remembering to list it here.
import { afterAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "@/core/db";
import { closeDb, hasDatabase } from "../helpers/spine";

describe.runIf(hasDatabase)("installed money readiness gates", () => {
  afterAll(closeDb);
  it("reports every freeholder_*_ready() gate as ready", async () => {
    const gates = await db().execute<{ sig: string }>(sql`
      select oid::regprocedure::text as sig from pg_proc
      where proname like 'freeholder\\_%\\_ready' and pronargs = 0
        and prorettype = 'boolean'::regtype
      order by sig`);
    // A migration could only remove gates by deleting them, which would itself
    // be a visible change; an empty result here means the schema is not loaded.
    expect(gates.length).toBeGreaterThanOrEqual(6);
    const verdicts: Record<string, boolean | null> = {};
    for (const { sig } of gates) {
      const name = sig.replace(/\(\)$/, "");
      const [row] = await db().execute<{ ready: boolean }>(sql.raw(`select ${name}() as ready`));
      verdicts[name] = row?.ready ?? null;
    }
    // Asserted as one object so a failure names every gate and its verdict,
    // rather than stopping at the first false one.
    expect(verdicts).toEqual(Object.fromEntries(Object.keys(verdicts).map(name => [name, true])));
  });
});
