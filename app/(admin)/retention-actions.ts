// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use server";
// Thin callers for retention policies (C11.14). Apply enqueues the job; it
// does not purge inside this request.
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { ServiceError } from "@/core/service";
import {
  applyRetention,
  upsertRetentionPolicy,
} from "@/core/retention/service";
import { ownerFacing } from "./action-helpers";

const RETENTION = "/admin/retention";

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

function refused(error: unknown, fallback: string): never {
  const message = error instanceof ServiceError ? ownerFacing(error.message) : fallback;
  redirect(`${RETENTION}?error=${encodeURIComponent(message)}`);
}

export async function upsertRetentionPolicyAction(form: FormData): Promise<void> {
  const kind = text(form, "kind");
  const ttlDays = number(form, "ttlDays");
  if (!kind || ttlDays === null) {
    redirect(`${RETENTION}?error=${encodeURIComponent("Choose a kind and a number of days.")}`);
  }
  try {
    await upsertRetentionPolicy.call({ kind, ttlDays }, await actor());
  } catch (error) {
    refused(error, "That retention policy could not be saved.");
  }
  revalidatePath(RETENTION);
  redirect(`${RETENTION}?saved=policy`);
}

export async function applyRetentionAction(): Promise<void> {
  try {
    await applyRetention.call({}, await actor());
  } catch (error) {
    refused(error, "Retention could not be applied.");
  }
  revalidatePath(RETENTION);
  redirect(`${RETENTION}?saved=apply`);
}
