// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use server";
// C12.38/C1.08: the owner uses exactly the same fresh-verification shared services.
import { cookies, headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { requestMetadataFromHeaders } from "@/core/http/request-metadata";
import { ServiceError } from "@/core/service";
import { recoverProviderReader, reviewProviderReaderStopped } from "@/modules/subscriptions/provider-reader-recovery";
function text(form: FormData, key: string) { const value = form.get(key); return typeof value === "string" ? value.trim() : ""; }
async function actor() { return { ...await actorFromToken((await cookies()).get(SESSION_COOKIE)?.value), request: requestMetadataFromHeaders(await headers()) }; }
async function perform(form: FormData, review: boolean) {
  const subscriptionId = text(form, "subscriptionId"); let failed = false;
  if (!/^[a-f0-9-]{36}$/i.test(subscriptionId)) redirect("/admin/subscriptions");
  try {
    if (review) await reviewProviderReaderStopped.call({ subscriptionId, operationId: text(form, "operationId"), readId: text(form, "readId"), expectedCallerId: text(form, "callerId"),
      expectedAdmissionDigest: text(form, "admissionDigest"), expectedSourceRevision: text(form, "sourceRevision"), hostingEvidence: text(form, "hostingEvidence"),
      stoppedRuntimeReference: text(form, "stoppedRuntimeReference") || undefined, stoppedRuntimeAt: text(form, "stoppedRuntimeAt") || undefined,
      confirmation: text(form, "confirmation") as "ORIGINAL SUBSCRIPTION READ RUNTIME STOP VERIFIED" }, await actor());
    else await recoverProviderReader.call({ subscriptionId, operationId: text(form, "operationId") }, await actor());
    revalidatePath(`/admin/subscriptions/${subscriptionId}`);
  } catch (error) { if (!(error instanceof ServiceError)) throw error; failed = true; }
  redirect(`/admin/subscriptions/${subscriptionId}?readerResult=${failed ? "failed" : "saved"}`);
}
export async function reviewProviderReaderStoppedAction(form: FormData) { return perform(form, true); }
export async function recoverProviderReaderAction(form: FormData) { return perform(form, false); }
