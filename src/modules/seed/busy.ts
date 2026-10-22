// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Filling the demo site with six months of believable business (C1.38).
//
// A separate service from `demo.install` because it is a separate promise:
// the plain demo is the site a contributor's `pnpm dev` boots into, and has
// to stay quick; the busy layer is what the public playground shows an
// evaluator, and is opt-in (FREEHOLDER_SEED_DEMO=busy, or implied by
// FREEHOLDER_PLAYGROUND=1). It runs once, after the plain demo, in one
// transaction — so a failure leaves the plain demo intact rather than half a
// business.
import { z } from "zod";
import { count, eq } from "drizzle-orm";
import { defineService, ServiceError } from "@/core/service";
import { users } from "@/core/auth/schema";
import { db } from "@/core/db";
import { env } from "@/core/env";
import { playgroundBlocksExternalDelivery } from "@/core/demo/playground-policy";
import { businessProfile } from "@/core/settings/schema";
import { BUSINESS } from "../../../seed/demo/content";
import { seedBusyBusiness, world } from "../../../seed/demo/busy";

/** The assistant every staff-side record is attributed to. Marked demo (C12.16). */
export const BUSY_STAFF_EMAIL = "sam.okafor@demo.freeholder.test";

/**
 * Whether the plain demo is installed and its busy layer is not: the state a
 * boot leaves behind when it stopped between the two transactions. Read-only,
 * and true only for the demo business itself.
 */
export async function busyDemoPending(): Promise<boolean> {
  const [business] = await db().select({ name: businessProfile.name }).from(businessProfile).limit(1);
  if (business?.name !== BUSINESS.name) return false;
  const [sentinel] = await db()
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, BUSY_STAFF_EMAIL))
    .limit(1);
  return !sentinel;
}

export const installBusyDemo = defineService({
  name: "demo.installBusy",
  summary: "Add six months of sample customers, sales, bookings and traffic to the demo business.",
  kind: "mutation",
  permission: "scoped",
  external: false,
  writeClass: "write",
  input: z.object({
    /** The clock the sample business is drawn relative to. Tests pin it. */
    now: z.coerce.date().optional(),
  }),
  output: z.object({
    counts: z.record(z.string(), z.record(z.string(), z.number().int())),
  }),
  handler: async (input, ctx) => {
    // Busy data only ever lands once: the sample assistant is the tell that
    // it already ran.
    const [{ n } = { n: 0 }] = await ctx.tx
      .select({ n: count() })
      .from(users)
      .where(eq(users.email, BUSY_STAFF_EMAIL));
    if (n > 0) throw new ServiceError("conflict", "The busy demo is already installed.");

    const [owner] = await ctx.tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.role, "owner"))
      .limit(1);
    const [staff] = await ctx.tx
      .insert(users)
      .values({ email: BUSY_STAFF_EMAIL, role: "staff" })
      .returning({ id: users.id });
    const base = world(input.now ?? new Date());
    const counts = await seedBusyBusiness(ctx.tx, {
      ...base,
      ownerUserId: owner?.id ?? null,
      staffUserId: staff!.id,
      liveReminders: playgroundBlocksExternalDelivery(env()),
    });
    ctx.queueEvent("demo.busyInstalled", { contacts: counts.crm?.contacts ?? 0 });
    return { counts };
  },
});

export default [installBusyDemo];
