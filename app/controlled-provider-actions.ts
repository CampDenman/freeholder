// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use server";
import { cookies,headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { requestMetadataFromHeaders } from "@/core/http/request-metadata";
import { ServiceError } from "@/core/service";
import { reviewControlledProviderCallerStopped,type CONTROLLED_PROVIDER_STOP_CONFIRMATION } from "@/modules/subscriptions/controlled-provider-stop";
import { recoverControlledProviderOperation,recoverControlledProviderCalendar,stopControlledProviderCalendar } from "@/modules/subscriptions/controlled-provider-execution";
import { closeControlledZeroProviderResource } from "@/modules/subscriptions/controlled-provider-zero-closure";
const text=(form:FormData,key:string)=>{const value=form.get(key);return typeof value==="string"?value.trim():"";};
async function perform(form:FormData,kind:"review"|"recover"|"recover_resource"|"cancel"|"close"){
 const subscriptionId=text(form,"subscriptionId");if(!/^[a-f0-9-]{36}$/i.test(subscriptionId))redirect("/admin/subscriptions");const destination=text(form,"moneyRecovery")==="1"?`/admin/invoices/subscriptions/${subscriptionId}`:`/admin/subscriptions/${subscriptionId}`;let failed=false;
 try{
  const actor={...await actorFromToken((await cookies()).get(SESSION_COOKIE)?.value),request:requestMetadataFromHeaders(await headers())};
  if(kind==="review")await reviewControlledProviderCallerStopped.call({resourceId:text(form,"resourceId"),operationId:text(form,"operationId"),callId:text(form,"callId"),expectedCallerId:text(form,"callerId"),expectedAdmissionDigest:text(form,"admissionDigest"),expectedSourceRevision:text(form,"currentEvidenceRevision"),
   hostingEvidence:text(form,"hostingEvidence"),stoppedRuntimeReference:text(form,"stoppedRuntimeReference")||undefined,stoppedRuntimeAt:text(form,"stoppedRuntimeAt")||undefined,confirmation:text(form,"confirmation") as typeof CONTROLLED_PROVIDER_STOP_CONFIRMATION},actor);
  else if(kind==="recover")await recoverControlledProviderOperation.call({operationId:text(form,"operationId")},actor);
  else if(kind==="recover_resource")await recoverControlledProviderCalendar.call({resourceId:text(form,"resourceId")},actor);
  else if(kind==="cancel")await stopControlledProviderCalendar.call({resourceId:text(form,"resourceId")},actor);
  else await closeControlledZeroProviderResource.call({resourceId:text(form,"resourceId")},actor);
  revalidatePath(`/admin/subscriptions/${subscriptionId}`);revalidatePath(`/admin/invoices/subscriptions/${subscriptionId}`);
 }catch(error){if(!(error instanceof ServiceError))throw error;failed=true;}
 redirect(`${destination}?controlledResult=${failed?"failed":"saved"}`);
}
export async function reviewControlledProviderStopAction(form:FormData){return perform(form,"review");}
export async function recoverControlledProviderOperationAction(form:FormData){return perform(form,"recover");}
export async function stopControlledProviderCalendarAction(form:FormData){return perform(form,"cancel");}
export async function closeControlledZeroProviderResourceAction(form:FormData){return perform(form,"close");}

export async function recoverControlledProviderCalendarAction(form:FormData){return perform(form,"recover_resource");}
