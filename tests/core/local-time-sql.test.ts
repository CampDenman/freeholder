// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Local-time math lives in Node; SQL sees UTC instants (MASTER.md §4.9).
//
// Found in CI on 2026-10-22: a booking seeded at 15:30 Vancouver time by Node
// read back as 16:30 through Postgres, because the two carry separate copies
// of the tz database and those copies disagreed. Every query that bucketed by
// the business's day or month with `AT TIME ZONE` was moved to boundaries
// computed in Node. These tests keep it that way.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { bucketKey, inBuckets } from "@/core/db/buckets";
import { db, SESSION_SETTINGS } from "@/core/db";
import { localBuckets } from "@/core/i18n/zoned";
import { closeDb, hasDatabase } from "../helpers/spine";

const root = fileURLToPath(new URL("../..", import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name === "node_modules" || name.startsWith(".")) return [];
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx|mjs)$/.test(name) && !/\.test\./.test(name) ? [path] : [];
  });
}

/** SQL that asks Postgres what time it is somewhere. Comments are skipped. */
const LOCAL_TIME_SQL = [
  /\bat\s+time\s+zone\b/i,
  /\bcurrent_date\b/i,
  /\blocaltimestamp\b/i,
  /\bset\s+(local\s+)?time\s*zone\b/i,
];

/**
 * The one place that must ask Postgres for a local time: doctor's comparison
 * of Postgres's tz data with Node's, which exists to report the answer.
 */
const ALLOWED = new Set(["src/core/doctor/index.ts"]);

describe("no query asks Postgres for a local time", () => {
  it("has no AT TIME ZONE, current_date or localtimestamp in shipped code", () => {
    const offenders: string[] = [];
    for (const dir of ["src", "app", "plugins"]) {
      for (const file of sourceFiles(join(root, dir))) {
        if (ALLOWED.has(file.slice(root.length).replaceAll("\\", "/"))) continue;
        readFileSync(file, "utf8")
          .split("\n")
          .forEach((line, index) => {
            const code = line.trim();
            if (code.startsWith("//") || code.startsWith("*") || code.startsWith("/*")) return;
            if (LOCAL_TIME_SQL.some((pattern) => pattern.test(code))) {
              offenders.push(`${file.slice(root.length)}:${index + 1}: ${code}`);
            }
          });
      }
    }
    expect(
      offenders,
      "Compute local-time boundaries in Node (localBuckets / zonedInstant in " +
        "src/core/i18n/zoned.ts) and pass UTC instants to the query.",
    ).toEqual([]);
  });

  it("hands buckets to SQL as instants, with no zone in the query text", () => {
    const buckets = localBuckets(
      "America/Los_Angeles",
      new Date("2026-12-09T08:00:00Z"),
      new Date("2026-12-10T08:00:00Z"),
      "day",
    );
    const query = new PgDialect().sqlToQuery(
      sql`select ${bucketKey(sql.raw("at"), buckets)} from t where ${inBuckets(sql.raw("at"), buckets)}`,
    );
    expect(query.sql).not.toMatch(/time zone|Los_Angeles/i);
    // A binary search over start instants, not a join over ranges.
    expect(query.sql).toContain("width_bucket");
    expect(query.params).toEqual([
      "2026-12-09",
      "2026-12-09T08:00:00.000Z",
      "2026-12-09T08:00:00.000Z",
      "2026-12-10T08:00:00.000Z",
    ]);
  });
});

describe.runIf(hasDatabase)("every database session runs in UTC", () => {
  afterAll(async () => {
    await closeDb();
  });

  it("pins TimeZone on the connection rather than trusting the server default", async () => {
    expect(SESSION_SETTINGS).toEqual({ TimeZone: "UTC" });
    // The app's own pool, asked the way an operator would ask psql.
    const shown = await db().execute<{ TimeZone: string }>(sql`show timezone`);
    expect(shown[0]).toEqual({ TimeZone: "UTC" });
    const [row] = await db().execute<{ zone: string; day: string; month: string }>(sql`
      select current_setting('TimeZone') as zone,
             ('2026-12-09T23:30:00Z'::timestamptz)::date::text as day,
             date_trunc('month', '2026-11-30T23:30:00Z'::timestamptz)::text as month
    `);
    // A `::date` or `date_trunc` that remains in SQL is a UTC question. On a
    // server whose default zone is, say, America/Vancouver these would read
    // 2026-12-09 and 2026-11-01 00:00-07 — a different answer to the same row.
    expect(row).toEqual({
      zone: "UTC",
      day: "2026-12-09",
      month: "2026-11-01 00:00:00+00",
    });
  });

  it("buckets an instant by Node's boundaries whatever zone the session names", async () => {
    // Even a session deliberately set elsewhere cannot move a bucket: the
    // query compares instants with instants.
    const buckets = localBuckets(
      "America/Los_Angeles",
      new Date("2026-12-09T08:00:00Z"),
      new Date("2026-12-11T08:00:00Z"),
      "day",
    );
    const at = sql.raw("probe.at");
    const rows = await db().transaction(async (tx) => {
      await tx.execute(sql`set local TimeZone = 'Pacific/Kiritimati'`);
      return tx.execute<{ at: string; key: string }>(sql`
        select probe.at::text as at, ${bucketKey(at, buckets)} as key
        from (values ('2026-12-09T08:00:00Z'::timestamptz),
                     ('2026-12-09T23:30:00Z'::timestamptz),
                     ('2026-12-10T07:59:59Z'::timestamptz),
                     ('2026-12-10T08:00:00Z'::timestamptz),
                     ('2026-12-12T00:00:00Z'::timestamptz)) as probe(at)
        where ${inBuckets(at, buckets)}
        order by probe.at
      `);
    });
    // The first instant of a day opens it, the last second before the next
    // midnight still belongs to it, and anything past the span is left out.
    expect(rows.map((each) => each.key)).toEqual([
      "2026-12-09",
      "2026-12-09",
      "2026-12-09",
      "2026-12-10",
    ]);
  });
});
