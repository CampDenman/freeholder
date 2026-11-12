// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use server";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { resolveReaderOwnership } from "@/core/import/reader-ownership-review";
import { ServiceError } from "@/core/service";
import { getT } from "../i18n";
import { ownerFacing } from "./action-helpers";

export async function resolveReaderOwnershipAction(_previous: { error?: string }, form: FormData): Promise<{ error?: string }> {
  const text = (name: string) => { const value = form.get(name); return typeof value === "string" ? value.trim() : ""; };
  const path = `/admin/imports/${encodeURIComponent(text("id"))}`;
  try {
    await resolveReaderOwnership.call({ id: text("id"), receiptId: text("receiptId"), postId: text("postId"), commentId: text("commentId"), contactId: text("contactId"), confirmation: text("confirmation") as "ASSIGN ORIGINAL READER" }, await actorFromToken((await cookies()).get(SESSION_COOKIE)?.value));
  } catch (error) {
    if (error instanceof ServiceError && error.code === "step_up_required") redirect(`/security/verify?returnTo=${encodeURIComponent(path)}`);
    return { error: error instanceof ServiceError ? ownerFacing(error.message) : (await getT())("imports.readers.error") };
  }
  revalidatePath(path);
  redirect(path);
}
