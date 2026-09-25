// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use server";
// Calculator actions for the admin (MASTER.md §4.18, C5.26). Thin, like every
// other caller (§11).
//
// The configuration refusals are surfaced rather than swallowed. "This step
// uses an answer nobody is asked for" is the sentence that stops a calculator
// going live broken, and an owner is the right person to read it — a visitor
// is the worst.
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { ServiceError } from "@/core/service";
import {
  closeCalculator,
  createCalculator,
  publishCalculator,
  updateCalculator,
} from "@/modules/calculators/service";
import { ownerFacing } from "./action-helpers";

export interface CalculatorActionState {
  error?: string;
  saved?: boolean;
}

function text(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}

async function actor() {
  return actorFromToken((await cookies()).get(SESSION_COOKIE)?.value);
}

function asState(error: unknown, where: string): CalculatorActionState {
  if (error instanceof ServiceError) return { error: ownerFacing(error.message) };
  console.error(`${where} failed`, error);
  return { error: "Something went wrong. Try again." };
}

function refresh(id?: string) {
  revalidatePath("/admin/calculators", "layout");
  if (id) revalidatePath(`/admin/calculators/${id}`, "layout");
}

/**
 * Save the whole thing at once.
 *
 * The inputs and the steps arrive as one JSON value each, because that is what
 * is being edited: a document. `inputsSchema` and `stepsSchema` validate them —
 * the same schemas the evaluator reads — so a calculation the builder would
 * accept and the service would refuse cannot exist.
 */
export async function saveCalculatorAction(
  _previous: CalculatorActionState,
  form: FormData,
): Promise<CalculatorActionState> {
  let inputs: unknown = [];
  let steps: unknown = [];
  try {
    inputs = JSON.parse(text(form, "inputs") || "[]");
    steps = JSON.parse(text(form, "steps") || "[]");
  } catch {
    return { error: "The calculation could not be read. Reload and try again." };
  }

  const shared = {
    name: text(form, "name"),
    intro: text(form, "intro") || undefined,
    inputs: inputs as never,
    steps: steps as never,
    resultLabel: text(form, "resultLabel"),
    resultUnit: text(form, "resultUnit") || undefined,
    assumptions: text(form, "assumptions"),
  };

  const id = text(form, "id");
  let createdId: string | null = null;
  try {
    if (id) {
      await updateCalculator.call({ id, ...shared }, await actor());
    } else {
      createdId = (
        await createCalculator.call({ slug: text(form, "slug"), ...shared }, await actor())
      ).id;
    }
  } catch (error) {
    return asState(error, "saveCalculatorAction");
  }

  refresh(id || undefined);
  // Outside the try: redirect throws a signal Next handles.
  if (createdId) redirect(`/admin/calculators/${createdId}`);
  return { saved: true };
}

export async function publishCalculatorAction(
  _previous: CalculatorActionState,
  form: FormData,
): Promise<CalculatorActionState> {
  const id = text(form, "id");
  try {
    await publishCalculator.call({ id }, await actor());
  } catch (error) {
    return asState(error, "publishCalculatorAction");
  }
  refresh(id);
  return { saved: true };
}

export async function closeCalculatorAction(
  _previous: CalculatorActionState,
  form: FormData,
): Promise<CalculatorActionState> {
  const id = text(form, "id");
  try {
    await closeCalculator.call({ id }, await actor());
  } catch (error) {
    return asState(error, "closeCalculatorAction");
  }
  refresh(id);
  return { saved: true };
}
