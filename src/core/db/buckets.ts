// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Local-time buckets, handed to SQL as plain UTC instants (MASTER.md §4.9).
//
// Postgres has its own tz database and it is not the one Node renders with.
// A report that asks Postgres for `date_trunc('day', at at time zone $tz)`
// and a page that formats the same instant with `Intl` can land an hour — and
// so sometimes a whole day — apart whenever the two copies disagree. The
// boundaries are therefore computed in Node by `localBuckets` and handed over
// here as instants; the query never names a zone.
//
// `width_bucket` over the sorted start instants finds each row's bucket by
// binary search, so a two-year daily chart costs a few comparisons a row
// rather than a nested loop over 730 ranges.
import { sql, type SQL, type SQLWrapper } from "drizzle-orm";
import type { LocalBucket } from "@/core/i18n/zoned";

/**
 * The key (`YYYY-MM-DD`, `YYYY-MM`) of the bucket an instant column falls in.
 * Pair it with `inBuckets` in the `where`, which bounds the column to the span
 * the buckets cover: outside it the key is not meaningful.
 */
export function bucketKey(column: SQLWrapper, buckets: readonly LocalBucket[]): SQL<string> {
  if (buckets.length === 0) return sql<string>`null::text`;
  const keys = sql.join(buckets.map((each) => sql`${each.key}`), sql`, `);
  const starts = sql.join(
    buckets.map((each) => sql`${each.start.toISOString()}`),
    sql`, `,
  );
  return sql<string>`(array[${keys}]::text[])[width_bucket(${column}, array[${starts}]::timestamptz[])]`;
}

/** The column lies within the span the buckets cover: first start ≤ at < last end. */
export function inBuckets(column: SQLWrapper, buckets: readonly LocalBucket[]): SQL {
  if (buckets.length === 0) return sql`false`;
  return sql`(${column} >= ${buckets[0]!.start.toISOString()}::timestamptz and ${column} < ${buckets[buckets.length - 1]!.end.toISOString()}::timestamptz)`;
}
