// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Apply stored per-kind TTLs, skipping contacts with a privacy hold.
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { dataRequests, privacyRetentionExceptions } from "@/core/privacy/schema";
import { retentionPolicies } from "./schema";
import { retentionSources } from "./registry";
import "./sources";

const DAY_MS = 24 * 60 * 60 * 1_000;

async function exceptedContactIds(scope: string, now: Date): Promise<string[]> {
  const rows = await db()
    .select({
      contactId: dataRequests.contactId,
      expiresAt: privacyRetentionExceptions.expiresAt,
    })
    .from(privacyRetentionExceptions)
    .innerJoin(
      dataRequests,
      eq(dataRequests.id, privacyRetentionExceptions.dataRequestId),
    )
    .where(eq(privacyRetentionExceptions.scope, scope));
  return [
    ...new Set(
      rows
        .filter((row) => !row.expiresAt || row.expiresAt > now)
        .map((row) => row.contactId),
    ),
  ];
}

export async function applyRetentionPolicies(
  now = new Date(),
): Promise<{ purged: Record<string, number> }> {
  const policies = await db().select().from(retentionPolicies);
  const purged: Record<string, number> = {};
  for (const policy of policies) {
    const source = retentionSources().find((item) => item.kind === policy.kind);
    if (!source) continue;
    const exceptContactIds = await exceptedContactIds(source.privacyScope, now);
    const cutoff = new Date(now.getTime() - policy.ttlDays * DAY_MS);
    purged[policy.kind] = await source.purge({ cutoff, exceptContactIds });
  }
  return { purged };
}
