// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use server";
// Assessment actions for the admin. Thin, like every other caller (§11).
//
// Every refusal the service makes is surfaced here rather than swallowed,
// because in this module the refusals *are* the feature: "these questions can
// produce scores no band covers (4 to 7)" is the sentence that stops somebody
// publishing a questionnaire that would eventually have nothing to say.
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { ServiceError } from "@/core/service";
import {
  closeAssessment,
  createAssessment,
  deleteBand,
  deleteEscalation,
  publishAssessment,
  saveBand,
  saveEscalation,
  updateAssessment,
} from "@/modules/assessments/service";
import { ownerFacing } from "./action-helpers";

export interface AssessmentActionState {
  error?: string;
  saved?: boolean;
}

function text(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value : "";
}

function number(form: FormData, key: string): number {
  const parsed = Number.parseInt(text(form, key), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function actor() {
  return actorFromToken((await cookies()).get(SESSION_COOKIE)?.value);
}

function refresh(id?: string) {
  revalidatePath("/admin/assessments", "layout");
  if (id) revalidatePath(`/admin/assessments/${id}`, "layout");
}

/** Turn a service refusal into the sentence an owner can act on. */
function asState(error: unknown, where: string): AssessmentActionState {
  if (error instanceof ServiceError) return { error: ownerFacing(error.message) };
  console.error(`${where} failed`, error);
  return { error: "Something went wrong. Try again." };
}

/**
 * Create or change an assessment, questions and all.
 *
 * The whole question list arrives as one JSON value, because that is what is
 * being edited: a document. `questionsSchema` validates it — the same schema
 * the public block renders from and every answer is checked against — so a
 * question the builder would accept and the site would reject cannot exist.
 */
export async function saveAssessmentAction(
  _previous: AssessmentActionState,
  form: FormData,
): Promise<AssessmentActionState> {
  let questions: unknown = [];
  try {
    questions = JSON.parse(text(form, "questions") || "[]");
  } catch {
    return { error: "The questions could not be read. Reload and try again." };
  }

  const notify = text(form, "notify")
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter(Boolean);

  const shared = {
    name: text(form, "name"),
    intro: text(form, "intro") || undefined,
    questions: questions as never,
    destination: text(form, "destination") === "none" ? ("none" as const) : ("contact" as const),
    notify,
  };

  const id = text(form, "id");
  let createdId: string | null = null;
  try {
    if (id) {
      await updateAssessment.call({ id, ...shared }, await actor());
    } else {
      createdId = (
        await createAssessment.call({ slug: text(form, "slug"), ...shared }, await actor())
      ).id;
    }
  } catch (error) {
    return asState(error, "saveAssessmentAction");
  }

  refresh(id || undefined);
  // Outside the try: redirect throws a signal Next handles, and catching it
  // would turn every successful create into an error message.
  if (createdId) redirect(`/admin/assessments/${createdId}`);
  return { saved: true };
}

/**
 * Write one outcome band.
 *
 * The overlap refusal arrives here as a conflict, and it is worth showing in
 * full: two bands covering one score is the one way this module could be made
 * to give an answer that depends on row order.
 */
export async function saveBandAction(
  _previous: AssessmentActionState,
  form: FormData,
): Promise<AssessmentActionState> {
  const assessmentId = text(form, "assessmentId");
  try {
    await saveBand.call(
      {
        assessmentId,
        id: text(form, "id") || undefined,
        key: text(form, "key"),
        label: text(form, "label"),
        body: text(form, "body"),
        minScore: number(form, "minScore"),
        maxScore: number(form, "maxScore"),
        ordinal: number(form, "ordinal"),
      },
      await actor(),
    );
  } catch (error) {
    return asState(error, "saveBandAction");
  }
  refresh(assessmentId);
  return { saved: true };
}

export async function deleteBandAction(
  _previous: AssessmentActionState,
  form: FormData,
): Promise<AssessmentActionState> {
  const assessmentId = text(form, "assessmentId");
  try {
    await deleteBand.call({ assessmentId, id: text(form, "id") }, await actor());
  } catch (error) {
    return asState(error, "deleteBandAction");
  }
  refresh(assessmentId);
  return { saved: true };
}

export async function saveEscalationAction(
  _previous: AssessmentActionState,
  form: FormData,
): Promise<AssessmentActionState> {
  const assessmentId = text(form, "assessmentId");
  try {
    await saveEscalation.call(
      {
        assessmentId,
        id: text(form, "id") || undefined,
        questionKey: text(form, "questionKey"),
        optionKey: text(form, "optionKey"),
        instruction: text(form, "instruction"),
        ordinal: number(form, "ordinal"),
      },
      await actor(),
    );
  } catch (error) {
    return asState(error, "saveEscalationAction");
  }
  refresh(assessmentId);
  return { saved: true };
}

export async function deleteEscalationAction(
  _previous: AssessmentActionState,
  form: FormData,
): Promise<AssessmentActionState> {
  const assessmentId = text(form, "assessmentId");
  try {
    await deleteEscalation.call({ assessmentId, id: text(form, "id") }, await actor());
  } catch (error) {
    return asState(error, "deleteEscalationAction");
  }
  refresh(assessmentId);
  return { saved: true };
}

/** Open it to visitors. Refused while any reachable score has no band. */
export async function publishAssessmentAction(
  _previous: AssessmentActionState,
  form: FormData,
): Promise<AssessmentActionState> {
  const id = text(form, "id");
  try {
    await publishAssessment.call({ id }, await actor());
  } catch (error) {
    return asState(error, "publishAssessmentAction");
  }
  refresh(id);
  return { saved: true };
}

export async function closeAssessmentAction(
  _previous: AssessmentActionState,
  form: FormData,
): Promise<AssessmentActionState> {
  const id = text(form, "id");
  try {
    await closeAssessment.call({ id }, await actor());
  } catch (error) {
    return asState(error, "closeAssessmentAction");
  }
  refresh(id);
  return { saved: true };
}
