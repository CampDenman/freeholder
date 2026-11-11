// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { reviewLegacyMailOwnership } from "@/core/mail/record-services";
import { ServiceError } from "@/core/service";
import { postedFromPath } from "./action-helpers";

const PATH = "/admin/retention/mail";
export async function reviewMailOwnershipAction(form: FormData): Promise<void> {
  const text = (key: string) => { const value = form.get(key); return typeof value === "string" ? value.trim() : ""; };
  try {
    await reviewLegacyMailOwnership.call({ kind: text("kind"), id: text("id"), expectedRecipient: text("expectedRecipient"), contactId: text("contactId"), evidence: text("evidence"), confirmation: text("confirmation") }, await actorFromToken((await cookies()).get(SESSION_COOKIE)?.value));
  } catch (error) {
    if (error instanceof ServiceError && error.code === "step_up_required") redirect(`/security/verify?returnTo=${encodeURIComponent(await postedFromPath(PATH))}`);
    redirect(`${PATH}?error=review`);
  }
  revalidatePath(PATH);
  redirect(`${PATH}?saved=review`);
}
