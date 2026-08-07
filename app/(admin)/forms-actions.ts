// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
"use server";
// Forms actions for the admin. Thin, like every other caller (§11).
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
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
