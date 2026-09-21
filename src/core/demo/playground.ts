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
import { PLAYGROUND_MANAGE, PLAYGROUND_VIEW } from "./playground-policy";

const OWNER = "operator@playground.invalid";
const VISITOR = "visitor@playground.invalid";

export async function initializePlayground(): Promise<void> {
  if (env().FREEHOLDER_PLAYGROUND !== "1") return;
  await db().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(1946127)`);
    const existing = await tx.select({ email: users.email }).from(users);
    if (existing.some((user) => ![OWNER, VISITOR].includes(user.email))) {
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
