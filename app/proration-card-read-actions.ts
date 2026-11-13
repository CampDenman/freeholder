// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use server";
import { cookies, headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { requestMetadataFromHeaders } from "@/core/http/request-metadata";
import { ServiceError } from "@/core/service";
import { reviewProrationPaymentReadStopped, PRORATION_READ_STOP_CONFIRMATION } from "@/modules/subscriptions/proration-card-read-recovery";
function text(form: FormData, key: string) { const value = form.get(key); return typeof value === "string" ? value.trim() : ""; }
export async function reviewProrationPaymentReadStoppedAction(form: FormData) {
  const paymentId = text(form, "paymentId");
  if (!/^[a-f0-9-]{36}$/i.test(paymentId)) redirect("/admin/invoices");
  let failed = false;
  try {
    const actor = { ...await actorFromToken((await cookies()).get(SESSION_COOKIE)?.value), request: requestMetadataFromHeaders(await headers()) };
    await reviewProrationPaymentReadStopped.call({ paymentId, readId: text(form, "readId"), expectedCallerId: text(form, "callerId"), expectedAdmissionDigest: text(form, "admissionDigest"),
      expectedSourceRevision: text(form, "sourceRevision"), hostingEvidence: text(form, "hostingEvidence"), stoppedRuntimeReference: text(form, "stoppedRuntimeReference") || undefined,
      stoppedRuntimeAt: text(form, "stoppedRuntimeAt") || undefined, confirmation: text(form, "confirmation") as typeof PRORATION_READ_STOP_CONFIRMATION }, actor);
    revalidatePath(`/admin/payments/${paymentId}/merchant`);
  } catch (error) { if (!(error instanceof ServiceError)) throw error; failed = true; }
  redirect(`/admin/payments/${paymentId}/merchant?${failed ? "error=conflict" : "saved=caller_reviewed"}`);
}
