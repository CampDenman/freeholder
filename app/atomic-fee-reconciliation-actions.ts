// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
"use server";
// C12.38: original shared permission/audit/step-up path, no supplied money.
import {cookies,headers} from "next/headers";
import {redirect} from "next/navigation";
import {revalidatePath} from "next/cache";
import {z} from "zod";
import {SESSION_COOKIE} from "@/core/auth/sessions";
import {actorFromToken} from "@/core/http/actor";
import {requestMetadataFromHeaders} from "@/core/http/request-metadata";
import {ServiceError} from "@/core/service";
import {refreshAtomicFeeBankEvidence,reviewAtomicFeeReconciliation} from "@/modules/invoicing/controlled-atomic-fee-review";
import {reconcileMerchantApplicationFee} from "@/modules/invoicing/merchant-fee-service";
export async function reconcileAtomicFeeAction(form:FormData){
 const invoiceId=z.uuid().parse(form.get("invoiceId")),paymentId=z.uuid().parse(form.get("paymentId")),path=`/admin/invoices/${invoiceId}`;
 const actor={...await actorFromToken((await cookies()).get(SESSION_COOKIE)?.value),request:requestMetadataFromHeaders(await headers())};
 try{const rows=await reviewAtomicFeeReconciliation.call({invoiceId},actor);if(!rows.some(row=>row.paymentId===paymentId))throw new ServiceError("conflict","Review the exact original payment on this invoice before reconciling its fee.");
  if(form.get("intent")==="inspect")await refreshAtomicFeeBankEvidence.call({paymentId},actor);
  else await reconcileMerchantApplicationFee.call({paymentId},actor);
 }catch(error){if(error instanceof ServiceError&&error.code==="step_up_required")redirect(`/security/verify?returnTo=${encodeURIComponent(path)}`);redirect(`${path}?error=${encodeURIComponent(error instanceof ServiceError?error.code:"failed")}`);}
 revalidatePath(path);redirect(path);
}
