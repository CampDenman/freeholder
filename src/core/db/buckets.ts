// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Local-time buckets, handed to SQL as plain UTC instants (MASTER.md §4.9).
//
// Postgres has its own tz database and it is not the one Node renders with.
// A report that asks Postgres for `date_trunc('day', at at time zone $tz)`
// and a page that formats the same instant with `Intl` can land an hour — and
// so sometimes a whole day — apart whenever the two copies disagree. The
// boundaries are therefore computed in Node by `localBuckets` and joined here
// as a table of `(key, starts, ends)` rows; the query never names a zone.
import { sql, type SQL } from "drizzle-orm";
import type { LocalBucket } from "@/core/i18n/zoned";

/**
 * `(values (key, starts, ends), …) as <alias>(key, starts, ends)` for use in a
 * `from` or `join`. Join with `at >= alias.starts and at < alias.ends`.
 */
export function bucketTable(buckets: readonly LocalBucket[], alias = "bucket"): SQL {
  const name = sql.identifier(alias);
  if (buckets.length === 0) {
    return sql`(select null::text as key, null::timestamptz as starts, null::timestamptz as ends where false) as ${name}`;
  }
  const rows = sql.join(
    buckets.map(
      (each) =>
        sql`(${each.key}::text, ${each.start.toISOString()}::timestamptz, ${each.end.toISOString()}::timestamptz)`,
    ),
    sql`, `,
  );
  return sql`(values ${rows}) as ${name}(key, starts, ends)`;
}
