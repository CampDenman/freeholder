// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use server";
// Forms actions for the admin. Thin, like every other caller (§11).
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { reviewSubmission } from "@/modules/forms/service";

function text(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value : "";
}

/**
 * Move a submission between the inbox and the quarantine queue.
 *
 * Rescuing one is the half of §36's quarantine that makes it a queue rather
 * than a bin, and it is not merely a status change: a rescued submission puts
 * the person on the spine exactly as an unflagged one would have.
 */
export async function reviewSubmissionAction(form: FormData): Promise<void> {
  const actor = await actorFromToken(
    (await cookies()).get(SESSION_COOKIE)?.value,
  );
  const status = text(form, "status") === "spam" ? "spam" : "received";
  await reviewSubmission.call({ id: text(form, "id"), status }, actor);
  revalidatePath("/admin/forms", "layout");
}

export interface ActionState {
  error?: string;
  saved?: boolean;
}

/**
 * A validation message with its machine addressing removed.
 *
 * `defineService` prefixes a rejected input with the service name and the
 * failing path — `forms.update: fields: The field "x" is…` — which is right
 * for an API caller and noise above a text box. The sentence after it was
 * written for a person, so that is what an owner is shown. (The general fix
 * is task #19, catalog keys for service errors; this is the one screen where
 * the leak is in front of somebody who is not a developer.)
 */
function ownerFacing(message: string): string {
  return message.replace(/^[a-z][\w.]*: (?:[\w.[\]]+: )?/, "");
}

/**
 * Create or change a form, questions and all.
 *
 * The whole field list arrives as one JSON value, because that is what is
 * being edited: a document. `fieldsSchema` is what validates it — the same
 * schema the public form is rendered from and every submission is checked
 * against — so a question the builder would accept and the site would reject
 * cannot exist.
 */
export async function saveFormAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const actor = await actorFromToken(
    (await cookies()).get(SESSION_COOKIE)?.value,
  );

  let fields: unknown = [];
  try {
    fields = JSON.parse(text(form, "fields") || "[]");
  } catch {
    return { error: "The questions could not be read. Reload and try again." };
  }

  const notify = text(form, "notify")
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter(Boolean);

  const shared = {
    name: text(form, "name"),
    fields,
    submitLabel: text(form, "submitLabel") || undefined,
    successMessage: text(form, "successMessage") || undefined,
    destination: text(form, "destination") === "none" ? ("none" as const) : ("contact" as const),
    notify,
  };

  const id = text(form, "id");
  let createdId: string | null = null;
  try {
    if (id) {
      const { updateForm } = await import("@/modules/forms/service");
      await updateForm.call(
        {
          id,
          ...shared,
          status: text(form, "status") === "closed" ? "closed" : "active",
        },
        actor,
      );
    } else {
      const { createForm } = await import("@/modules/forms/service");
      createdId = (
        await createForm.call({ slug: text(form, "slug"), ...shared }, actor)
      ).id;
    }
  } catch (error) {
    const { ServiceError } = await import("@/core/service");
    if (error instanceof ServiceError) return { error: ownerFacing(error.message) };
    console.error("saveFormAction failed", error);
    return { error: "Something went wrong. Try again." };
  }

  revalidatePath("/admin/forms", "layout");
  // Outside the try: redirect throws a signal Next handles, and catching it
  // would turn every successful create into an error message.
  if (createdId) redirect(`/admin/forms/${createdId}/edit`);
  return { saved: true };
}
