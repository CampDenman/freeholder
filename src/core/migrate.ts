// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
// Bringing the schema up to date at boot.
//
// §14 promises a one-command deploy. A recipe whose documented start command
// leaves an empty database and a 500 has not delivered that, and "now run the
// migrations" is exactly the step a one-person business should never have to
// know about. Migrations already travel inside the image so a release cannot be
// newer than the schema it expects; this is what applies them.
//
// The tradeoff is deliberate. Teams running many replicas usually migrate in a
// separate step, because a bad migration otherwise takes every instance down at
// once. Freeholder's Tier-1 targets are a single droplet and a single Replit
// container, where that risk does not exist and the convenience is decisive.
// Anyone who wants the other behaviour sets FREEHOLDER_SKIP_MIGRATE=1 and runs
// them their own way.
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { env } from "@/core/env";

export interface MigrateResult {
  ran: boolean;
  reason?: string;
}

export async function migrateToLatest(): Promise<MigrateResult> {
  if (process.env.FREEHOLDER_SKIP_MIGRATE === "1") {
    return { ran: false, reason: "FREEHOLDER_SKIP_MIGRATE=1" };
  }
  const url = env().DATABASE_URL;
  if (!url) return { ran: false, reason: "no DATABASE_URL" };

  // Its own single connection, closed straight after: the app's pool outlives
  // this and should not hold a migration lock for the life of the process.
  const client = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await migrate(drizzle(client), { migrationsFolder: "db/migrations" });
    return { ran: true };
  } finally {
    await client.end();
  }
}
