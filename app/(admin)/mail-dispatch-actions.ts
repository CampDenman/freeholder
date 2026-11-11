// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { reconcileMailDispatch, retryReconciledMail } from "@/core/mail/dispatch-services";
import { ServiceError } from "@/core/service";

const PATH = "/admin/retention/mail/recovery";
export async function reconcileMailDispatchAction(form: FormData): Promise<void> {
  const text = (key: string) => { const value = form.get(key); return typeof value === "string" ? value.trim() : ""; };
  try {
    await reconcileMailDispatch.call({ deliveryId: text("deliveryId"), ...(text("dispatchId") ? { dispatchId: text("dispatchId") } : {}), expectedAttempts: Number(text("expectedAttempts")), expectedRecipient: text("expectedRecipient"), expectedProviderRef: text("expectedProviderRef") || null, outcome: text("outcome"), originalRouteEvidence: text("originalRouteEvidence"), finalProviderEvidence: text("finalProviderEvidence"), stoppedCallerEvidence: text("stoppedCallerEvidence"), providerOperationRef: text("providerOperationRef"), confirmation: text("confirmation") }, await actorFromToken((await cookies()).get(SESSION_COOKIE)?.value));
  } catch (error) {
    if (error instanceof ServiceError && error.code === "step_up_required") redirect(`/security/verify?returnTo=${encodeURIComponent(PATH)}`);
    redirect(`${PATH}?error=review`);
  }
  revalidatePath(PATH); revalidatePath("/admin/settings"); redirect(`${PATH}?saved=review`);
}
export async function retryReconciledMailAction(form: FormData): Promise<void> {
  try {
    await retryReconciledMail.call({ deliveryId: form.get("deliveryId"), confirmation: form.get("confirmation") }, await actorFromToken((await cookies()).get(SESSION_COOKIE)?.value));
  } catch (error) {
    if (error instanceof ServiceError && error.code === "step_up_required") redirect(`/security/verify?returnTo=${encodeURIComponent(PATH)}`);
    redirect(`${PATH}?error=retry`);
  }
  revalidatePath(PATH); revalidatePath("/admin/settings"); redirect(`${PATH}?saved=retry`);
}
