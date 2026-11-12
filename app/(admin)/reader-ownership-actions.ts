// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use server";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { resolveReaderOwnership, resolveReaderOwnershipBatch } from "@/core/import/reader-ownership-review";
import { ServiceError } from "@/core/service";
import { getT } from "../i18n";
import { ownerFacing } from "./action-helpers";

export async function resolveReaderOwnershipAction(_previous: { error?: string }, form: FormData): Promise<{ error?: string }> {
  const text = (name: string) => { const value = form.get(name); return typeof value === "string" ? value.trim() : ""; };
  const path = `/admin/imports/${encodeURIComponent(text("id"))}`;
  try {
    await resolveReaderOwnership.call({ id: text("id"), receiptId: text("receiptId") || null, postId: text("postId"), commentId: text("commentId"), contactId: text("contactId"), confirmation: text("confirmation") as "ASSIGN ORIGINAL READER" }, await actorFromToken((await cookies()).get(SESSION_COOKIE)?.value));
  } catch (error) {
    if (error instanceof ServiceError && error.code === "step_up_required") redirect(`/security/verify?returnTo=${encodeURIComponent(path)}`);
    return { error: error instanceof ServiceError ? ownerFacing(error.message) : (await getT())("imports.readers.error") };
  }
  revalidatePath(path);
  redirect(path);
}

export async function resolveReaderOwnershipBatchAction(_previous: { error?: string }, form: FormData): Promise<{ error?: string }> {
  const rawId = form.get("id");
  const id = typeof rawId === "string" ? rawId : "";
  const path = `/admin/imports/${encodeURIComponent(id)}`;
  try {
    const selected = form.getAll("selected");
    if (selected.length < 1 || selected.length > 50) throw new ServiceError("validation", "Choose between one and fifty original readers.");
    const assignments = selected.map(value => {
      if (typeof value !== "string" || value.length > 400) throw new ServiceError("validation", "The selected original reader is invalid.");
      const [receiptId, postId, commentId] = value.split(":");
      return { receiptId: receiptId || null, postId, commentId, contactId: form.get(`person:${value}`) };
    });
    await resolveReaderOwnershipBatch.call({ id, assignments, confirmation: "ASSIGN SELECTED ORIGINAL READERS" }, await actorFromToken((await cookies()).get(SESSION_COOKIE)?.value));
  } catch (error) {
    if (error instanceof ServiceError && error.code === "step_up_required") redirect(`/security/verify?returnTo=${encodeURIComponent(path)}`);
    return { error: error instanceof ServiceError ? ownerFacing(error.message) : (await getT())("imports.readers.error") };
  }
  revalidatePath(path);
  redirect(path);
}
