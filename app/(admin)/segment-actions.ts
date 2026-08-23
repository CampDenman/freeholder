// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use server";
// Thin callers for segments (C7.04). The rule compiler, the refusal of a field
// nothing knows about, and the freeze-once rule all live in `core/segments`, so
// a segment built on this screen and one posted over the API mean exactly the
// same thing.
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { ServiceError } from "@/core/service";
import { captureSegment, removeSegment, saveSegment } from "@/core/segments/service";
import { ownerFacing } from "./action-helpers";

const SEGMENTS = "/admin/segments";

function text(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}

async function actor() {
  return actorFromToken((await cookies()).get(SESSION_COOKIE)?.value);
}

function refused(error: unknown, fallback: string): never {
  const message = error instanceof ServiceError ? ownerFacing(error.message) : fallback;
  redirect(`${SEGMENTS}?error=${encodeURIComponent(message)}`);
}

/**
 * The rules a no-JavaScript form can express.
 *
 * Three rows of field/operator/value, which is enough for §4.14's own example —
 * "customers in Ontario who bought twice" is two — and every row left blank is
 * simply not a rule. A richer builder is a client-side concern; this one has to
 * work on a phone with a bad connection, and the model behind it accepts thirty.
 */
function rulesFrom(form: FormData) {
  const fields = form.getAll("field").map(String);
  const ops = form.getAll("op").map(String);
  const values = form.getAll("value").map(String);
  return fields
    .map((field, index) => ({
      field: field.trim(),
      op: (ops[index] ?? "is").trim(),
      value: parseValue((values[index] ?? "").trim()),
    }))
    .filter((rule) => rule.field.length > 0);
}

/**
 * What an owner typed, as the value the field expects.
 *
 * Commas mean a list, because "one of" is the operator people reach for and
 * asking them to write JSON is not an option. `true`/`false` and plain numbers
 * are read as themselves so a boolean or a count does not arrive as a string
 * the compiler then has to guess about.
 */
function parseValue(raw: string): unknown {
  if (raw === "") return undefined;
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (raw.includes(",")) {
    return raw
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
  }
  return /^-?\d+$/.test(raw) ? Number(raw) : raw;
}

export async function saveSegmentAction(form: FormData): Promise<void> {
  try {
    const rules = rulesFrom(form);
    if (rules.length === 0) {
      throw new ServiceError("validation", "A segment needs at least one rule.");
    }
    await saveSegment.call(
      {
        ...(text(form, "id") ? { id: text(form, "id") } : {}),
        name: text(form, "name"),
        description: text(form, "description") || null,
        definition: {
          match: text(form, "match") === "any" ? "any" : "all",
          rules,
        },
      },
      await actor(),
    );
  } catch (error) {
    refused(error, "That segment could not be saved.");
  }
  revalidatePath(SEGMENTS);
  redirect(`${SEGMENTS}?saved=segment`);
}

export async function captureSegmentAction(form: FormData): Promise<void> {
  try {
    await captureSegment.call({ id: text(form, "id") }, await actor());
  } catch (error) {
    refused(error, "That segment could not be captured.");
  }
  revalidatePath(SEGMENTS);
  redirect(`${SEGMENTS}?saved=captured`);
}

export async function removeSegmentAction(form: FormData): Promise<void> {
  try {
    await removeSegment.call({ id: text(form, "id") }, await actor());
  } catch (error) {
    refused(error, "That segment could not be removed.");
  }
  revalidatePath(SEGMENTS);
  redirect(`${SEGMENTS}?saved=removed`);
}
