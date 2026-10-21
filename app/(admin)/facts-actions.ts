// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use server";
// Published-fact actions for the admin (MASTER.md §4.18, C8.15). Thin, like
// every other caller (§11).
//
// There is no "edit" here, and that absence is the feature. An owner records a
// fact or corrects it; nothing rewrites a value in place, because the moment
// one did, the ledger would stop being a record of what the business actually
// said and become a record of what it currently prefers to have said.
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { ServiceError } from "@/core/service";
import { correctFact, recordFact, withdrawFact } from "@/core/attestations/service";
import { ownerFacing } from "./action-helpers";

export interface FactActionState {
  error?: string;
  saved?: boolean;
}

function text(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function optional(form: FormData, key: string): string | undefined {
  const value = text(form, key);
  return value || undefined;
}

/** A datetime-local field posts "2026-09-19T09:00" with no zone. */
function moment(form: FormData, key: string): Date {
  const raw = text(form, key);
  const parsed = raw ? new Date(raw) : new Date(Number.NaN);
  return parsed;
}

async function actor() {
  return actorFromToken((await cookies()).get(SESSION_COOKIE)?.value);
}

function subjectFrom(form: FormData) {
  const kind = optional(form, "subjectKind");
  const id = optional(form, "subjectId");
  return kind || id ? { kind, id } : undefined;
}

function asState(error: unknown, where: string): FactActionState {
  if (error instanceof ServiceError) return { error: ownerFacing(error.message) };
  console.error(`${where} failed`, error);
  return { error: "Something went wrong. Try again." };
}

function refresh(key?: string) {
  revalidatePath("/admin/facts", "layout");
  if (key) revalidatePath(`/admin/facts/${encodeURIComponent(key)}`, "layout");
}

export async function recordFactAction(
  _previous: FactActionState,
  form: FormData,
): Promise<FactActionState> {
  const key = text(form, "key");
  const asOf = moment(form, "asOf");
  if (Number.isNaN(asOf.getTime())) {
    return { error: "Say when this was true. A figure without a date is the thing this refuses to publish." };
  }
  const validUntilRaw = optional(form, "validUntil");
  try {
    await recordFact.call(
      {
        key,
        subject: subjectFrom(form),
        value: text(form, "value"),
        source: text(form, "source"),
        asOf,
        validUntil: validUntilRaw ? new Date(validUntilRaw) : undefined,
      },
      await actor(),
    );
  } catch (error) {
    return asState(error, "recordFactAction");
  }
  refresh(key);
  return { saved: true };
}

export async function correctFactAction(
  _previous: FactActionState,
  form: FormData,
): Promise<FactActionState> {
  const key = text(form, "key");
  const asOf = moment(form, "asOf");
  if (Number.isNaN(asOf.getTime())) {
    return { error: "Say when the new value was true." };
  }
  const validUntilRaw = optional(form, "validUntil");
  try {
    await correctFact.call(
      {
        key,
        subject: subjectFrom(form),
        value: text(form, "value"),
        source: text(form, "source"),
        asOf,
        validUntil: validUntilRaw ? new Date(validUntilRaw) : undefined,
        note: text(form, "note"),
      },
      await actor(),
    );
  } catch (error) {
    return asState(error, "correctFactAction");
  }
  refresh(key);
  return { saved: true };
}

export async function withdrawFactAction(
  _previous: FactActionState,
  form: FormData,
): Promise<FactActionState> {
  try {
    await withdrawFact.call(
      { id: text(form, "id"), reason: optional(form, "reason") },
      await actor(),
    );
  } catch (error) {
    return asState(error, "withdrawFactAction");
  }
  refresh(optional(form, "key"));
  return { saved: true };
}
