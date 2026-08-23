// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Moving somebody along the lifecycle, from anywhere (MASTER.md §4.1, C7.05).
//
// C7.01 established the rule this file has to respect: `contact_stages` holds
// the owner's fine stage and is the truth, every lifecycle stage declares which
// coarse `lifecycle_stage` it derives, and `crm.moveContactStage` is the single
// write path that sets both. Anything that writes the coarse enum on its own
// leaves the board stale, which is the fork the contact spine exists to
// prevent.
//
// Scoring (C7.05) has to move people — §4.14's "quote accepted → auto-advance"
// — and scoring is core. Core may not import a module (§11), so the direction
// is inverted: core asks whatever is registered, and the CRM module registers
// itself. With no module installed the fallback writes the enum directly, which
// is correct because on that instance there is no fine stage to keep in step.
//
// The forward-only rule lives here rather than in each caller. A newsletter
// signup must not demote a customer back to a lead, and neither must a scoring
// rule that fires on an email open.
import type { ServiceContext } from "@/core/service";

/** The coarse ladder, in order. Index is seniority; nothing moves backwards. */
export const LIFECYCLE_LADDER = ["lead", "prospect", "customer", "repeat"] as const;

export type LifecycleStage = (typeof LIFECYCLE_LADDER)[number];

/**
 * What actually performs the move.
 *
 * Returns `true` if it handled it. A registered advancer that cannot resolve a
 * fine stage for the coarse value — an instance with pipelines installed but no
 * stage deriving "repeat" — returns `false` and lets the fallback write the
 * enum, because refusing to advance somebody would be a worse answer than
 * advancing them without a board position.
 */
export type LifecycleAdvancer = (
  ctx: ServiceContext,
  contactId: string,
  stage: LifecycleStage,
) => Promise<boolean>;

let registered: LifecycleAdvancer | null = null;

/** The CRM module claims this at import time; nothing else may. */
export function registerLifecycleAdvancer(advancer: LifecycleAdvancer): void {
  registered = advancer;
}

/** Only for tests that need to assert the fallback path. */
export function clearLifecycleAdvancer(): void {
  registered = null;
}

/** Is `next` further along than `current`? */
export function isForward(current: LifecycleStage, next: LifecycleStage): boolean {
  return LIFECYCLE_LADDER.indexOf(next) > LIFECYCLE_LADDER.indexOf(current);
}

/**
 * Advance a contact to a stage, through whatever owns the lifecycle here.
 *
 * Returns whether anything moved: a contact already at or beyond the stage is
 * left alone, which is what makes this safe to call on every matching event
 * rather than only on the first.
 */
export async function advanceLifecycle(
  ctx: ServiceContext,
  contactId: string,
  stage: LifecycleStage,
): Promise<boolean> {
  const { contacts } = await import("@/core/contacts/schema");
  const { eq } = await import("drizzle-orm");
  const [existing] = await ctx.tx
    .select({ stage: contacts.lifecycleStage })
    .from(contacts)
    .where(eq(contacts.id, contactId))
    .limit(1);
  if (!existing || !isForward(existing.stage, stage)) return false;

  if (registered && (await registered(ctx, contactId, stage))) return true;

  const { getService } = await import("@/core/service");
  // Elevated: the machinery that advances somebody is acting for the business,
  // and the event that triggered it may have come from an anonymous surface.
  await ctx.callAsSystem(getService("contacts.update"), {
    id: contactId,
    lifecycleStage: stage,
  });
  return true;
}
