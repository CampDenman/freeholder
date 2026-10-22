// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.38: "is the database this process was booted against still there?"
//
// Narrower than readiness on purpose. Readiness also fails while job workers
// are degraded or a heartbeat is late, which is exactly what a CPU-starved
// demo looks like during a traffic spike; a container health check built on it
// would mark a busy-but-working playground unhealthy and get it rebuilt mid
// launch. This asks one cheap question: does the migrated schema exist? The
// public playground's tmpfs database comes back empty if it is killed, and
// that — not slowness — is what its heal check must catch.
import { sql } from "drizzle-orm";
import { db } from "@/core/db";

export type SchemaProbe = "ok" | "schema_missing" | "unavailable";

const TIMEOUT_MS = 3_000;

/** `to_regclass` is null when the table was never migrated into this database. */
export async function probeSchema(
  query: () => Promise<boolean> = async () => {
    const rows = await db().execute<{ present: boolean }>(
      sql`select to_regclass('public.users') is not null as present`,
    );
    return Boolean(rows[0]?.present);
  },
): Promise<SchemaProbe> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"unavailable">((resolve) => {
    timer = setTimeout(() => resolve("unavailable"), TIMEOUT_MS);
  });
  try {
    return await Promise.race([
      query().then((present): SchemaProbe => (present ? "ok" : "schema_missing")),
      timeout,
    ]);
  } catch {
    return "unavailable";
  } finally {
    clearTimeout(timer);
  }
}
