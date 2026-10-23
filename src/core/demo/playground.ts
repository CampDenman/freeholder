// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.38: explicitly provisioned, disposable public playground identity.
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/core/db";
import { env } from "@/core/env";
import { roles, roleGrants, sessions, users } from "@/core/auth/schema";
import { createSession } from "@/core/auth/sessions";
import { seedDefaultRoles } from "@/core/roles/defaults";
import { defineService, ServiceError } from "@/core/service";
import { moduleSettings } from "@/core/settings/schema";
import {
  PLAYGROUND_BASELINE_MODULE,
  PLAYGROUND_MANAGE,
  PLAYGROUND_VIEW,
  playgroundCappedTables,
} from "./playground-policy";

const OWNER = "operator@playground.invalid";
const VISITOR = "visitor@playground.invalid";

export async function initializePlayground(): Promise<void> {
  if (env().FREEHOLDER_PLAYGROUND !== "1") return;
  await db().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(1946127)`);
    const existing = await tx.select({ email: users.email }).from(users);
    // Marked demo members (C12.16) are part of the playground's demo content.
    if (existing.some((user) => ![OWNER, VISITOR].includes(user.email) && !user.email.endsWith("@demo.freeholder.test"))) {
      throw new Error("Playground mode requires a disposable database with no real users.");
    }
    await seedDefaultRoles(tx);
    await tx.insert(roles).values({ key: "playground", name: "Playground visitor", isSystem: true, assignable: false }).onConflictDoNothing();
    await tx.delete(roleGrants).where(eq(roleGrants.roleKey, "playground"));
    await tx.insert(roleGrants).values([
      ...PLAYGROUND_MANAGE.map((module) => ({ roleKey: "playground", module, access: "manage" as const })),
      ...PLAYGROUND_VIEW.map((module) => ({ roleKey: "playground", module, access: "view" as const })),
    ]);
    // No password and no public path to issue a session for the sentinel owner.
    await tx.insert(users).values([{ email: OWNER, role: "owner" }, { email: VISITOR, role: "playground" }]).onConflictDoNothing();
  });
}

/**
 * Record how many rows each capped table holds now that the sample site is
 * installed. Boot calls this after the demo seed (instrumentation.node.ts),
 * so every hourly reset starts the caps from the freshly seeded sample.
 *
 * Once per database, never again: the hourly reset recreates the database,
 * so the first boot after it is the one that follows the seed. A restart
 * mid-hour (a crash, a heal, a deploy) must not count visitors' rows as
 * seed and hand the caps back their headroom.
 */
export async function markPlaygroundBaseline(): Promise<void> {
  if (env().FREEHOLDER_PLAYGROUND !== "1") return;
  const baseline: Record<string, number> = {};
  for (const table of playgroundCappedTables()) {
    const [row] = await db().execute<{ count: number }>(
      sql`select count(*)::int as count from ${sql.identifier(table)}`,
    );
    baseline[table] = Number(row?.count ?? 0);
  }
  await db()
    .insert(moduleSettings)
    .values({ module: PLAYGROUND_BASELINE_MODULE, config: { baseline } })
    .onConflictDoNothing({ target: moduleSettings.module });
}

/**
 * Run late seed work and count its rows as baseline (C1.38).
 *
 * The busy demo layer can finish on a restart after the plain demo (see
 * seedDemoIfRequested). When the baseline was already recorded, the rows it
 * adds are still seed, so they are added to the stored baseline rather than
 * eating the visitors' headroom. Without a stored baseline this is just the
 * work: the boot records the baseline afterwards.
 */
export async function extendPlaygroundBaseline<T>(work: () => Promise<T>): Promise<T> {
  if (env().FREEHOLDER_PLAYGROUND !== "1") return work();
  const [stored] = await db()
    .select({ config: moduleSettings.config })
    .from(moduleSettings)
    .where(eq(moduleSettings.module, PLAYGROUND_BASELINE_MODULE))
    .limit(1);
  if (!stored) return work();
  const countAll = async () => {
    const counts: Record<string, number> = {};
    for (const table of playgroundCappedTables()) {
      const [row] = await db().execute<{ count: number }>(
        sql`select count(*)::int as count from ${sql.identifier(table)}`,
      );
      counts[table] = Number(row?.count ?? 0);
    }
    return counts;
  };
  const before = await countAll();
  const result = await work();
  const after = await countAll();
  const baseline = { ...((stored.config as { baseline?: Record<string, number> }).baseline ?? {}) };
  for (const table of Object.keys(after)) {
    baseline[table] = (baseline[table] ?? 0) + Math.max(0, after[table]! - (before[table] ?? 0));
  }
  await db()
    .update(moduleSettings)
    .set({ config: { baseline } })
    .where(eq(moduleSettings.module, PLAYGROUND_BASELINE_MODULE));
  return result;
}

export const enterPlayground = defineService({
  name: "playground.enter",
  summary: "Enter a disposable public demo with restricted content-editing access.",
  kind: "mutation",
  permission: "public",
  external: false,
  input: z.object({}),
  output: z.object({ token: z.string(), expiresAt: z.date() }),
  rateLimit: { limit: 120, windowSeconds: 60, subject: () => "playground-entry", message: "The playground is busy. Please try again shortly." },
  handler: async (_input, ctx) => {
    if (env().FREEHOLDER_PLAYGROUND !== "1") throw new ServiceError("not_found", "This instance is not a public playground.");
    const [visitor] = await ctx.tx.select().from(users).where(eq(users.email, VISITOR)).limit(1);
    if (!visitor || visitor.role !== "playground") throw new ServiceError("conflict", "The playground is being prepared. Try again shortly.");
    const session = await createSession(ctx.tx, visitor.id);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    await ctx.tx.update(sessions).set({ expiresAt }).where(eq(sessions.id, session.sessionId));
    return { token: session.token, expiresAt };
  },
});
