// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { ServiceError } from "@/core/service";
import { reconcileLeadCopy, retryLeadCopy } from "@/modules/forms/lead-copy-services";
const PATH = "/admin/forms/lead-copies";
export async function reviewLeadCopyAction(form: FormData): Promise<void> {
  const text = (key: string) => { const value = form.get(key); return typeof value === "string" ? value.trim() : ""; };
  try {
    const actor = await actorFromToken((await cookies()).get(SESSION_COOKIE)?.value);
    if (text("action") === "retry") {
      await retryLeadCopy.call({ id: text("id"), expectedRevision: Number(text("expectedRevision")), confirmation: text("confirmation") }, actor);
    } else {
      await reconcileLeadCopy.call({ id: text("id"), expectedRevision: Number(text("expectedRevision")), operationId: text("operationId"), outcome: text("outcome"), originalResourceEvidence: text("originalResourceEvidence"), finalProviderEvidence: text("finalProviderEvidence"), stoppedCallerEvidence: text("stoppedCallerEvidence"), providerOperationRef: text("providerOperationRef"), ...(text("remoteErasureEvidence") ? { remoteErasureEvidence: text("remoteErasureEvidence") } : {}), confirmation: text("confirmation") }, actor);
    }
  } catch (error) {
    if (error instanceof ServiceError && error.code === "step_up_required") redirect(`/security/verify?returnTo=${encodeURIComponent(PATH)}`);
    redirect(`${PATH}?error=review`);
  }
  revalidatePath(PATH); redirect(`${PATH}?saved=review`);
}
