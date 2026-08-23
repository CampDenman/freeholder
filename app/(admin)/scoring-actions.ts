// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use server";
// Thin callers for scoring (C7.05). The decay arithmetic, the forward-only
// advance and the once-per-event guard all live in `core/scoring`, so a rule
// written here behaves exactly as one posted over the API.
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { ServiceError } from "@/core/service";
import {
  awardPoints,
  LIFECYCLE_LADDER,
  removeScoringRule,
  saveScoringRule,
  SCORING_RULE_KINDS,
} from "@/core/scoring/service";
import { ownerFacing } from "./action-helpers";

const SCORING = "/admin/scoring";

function text(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function number(form: FormData, key: string): number | null {
  const raw = text(form, key);
  if (raw === "") return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
}

async function actor() {
  return actorFromToken((await cookies()).get(SESSION_COOKIE)?.value);
}

/** A posted string, only if it is one of the values the service accepts. */
function oneOf<T extends string>(values: readonly T[], value: string): T | null {
  return values.find((allowed) => allowed === value) ?? null;
}

function refused(error: unknown, path: string, fallback: string): never {
  const message = error instanceof ServiceError ? ownerFacing(error.message) : fallback;
  redirect(`${path}?error=${encodeURIComponent(message)}`);
}

export async function saveScoringRuleAction(form: FormData): Promise<void> {
  try {
    const kind = oneOf(SCORING_RULE_KINDS, text(form, "kind")) ?? "event";
    await saveScoringRule.call(
      {
        ...(text(form, "id") ? { id: text(form, "id") } : {}),
        name: text(form, "name"),
        kind,
        eventName: text(form, "eventName") || null,
        points: number(form, "points") ?? 0,
        decayDays: number(form, "decayDays") ?? 0,
        maxAwards: number(form, "maxAwards"),
        advanceTo: oneOf(LIFECYCLE_LADDER, text(form, "advanceTo")),
        thresholdScore: number(form, "thresholdScore"),
        active: text(form, "active") !== "off",
      },
      await actor(),
    );
  } catch (error) {
    refused(error, SCORING, "That rule could not be saved.");
  }
  revalidatePath(SCORING);
  redirect(`${SCORING}?saved=rule`);
}

export async function removeScoringRuleAction(form: FormData): Promise<void> {
  try {
    await removeScoringRule.call({ id: text(form, "id") }, await actor());
  } catch (error) {
    refused(error, SCORING, "That rule could not be removed.");
  }
  revalidatePath(SCORING);
  redirect(`${SCORING}?saved=removed`);
}

/**
 * Points given by hand, from the contact's own screen.
 *
 * Posted back to wherever it came from, because this control belongs beside the
 * person it is about rather than on the rules page.
 */
export async function awardPointsAction(form: FormData): Promise<void> {
  const contactId = text(form, "contactId");
  const path = `/admin/contacts/${contactId}`;
  try {
    await awardPoints.call(
      {
        contactId,
        reason: text(form, "reason"),
        points: number(form, "points") ?? 0,
        decayDays: number(form, "decayDays") ?? 0,
      },
      await actor(),
    );
  } catch (error) {
    refused(error, path, "Those points could not be given.");
  }
  revalidatePath(path);
  redirect(`${path}?saved=score`);
}
