// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: a member declares only their own business through the shared service.
"use server";
import {cookies} from "next/headers";
import {redirect} from "next/navigation";
import {SESSION_COOKIE} from "@/core/auth/sessions";
import {actorFromToken} from "@/core/http/actor";
import {ServiceError} from "@/core/service";
import {merchantTaxFormValues} from "@/modules/invoicing/merchant-tax-form";
import {saveMyMerchantTaxProfile} from "@/modules/invoicing/merchant-tax-profiles";
export async function saveMemberTaxAction(form:FormData):Promise<void>{
 try{
  const parsed=saveMyMerchantTaxProfile.def.input.safeParse({...merchantTaxFormValues(form),liability:"seller"});
  if(!parsed.success)throw new ServiceError("validation","Review the business tax declaration fields before saving.");
  await saveMyMerchantTaxProfile.call(parsed.data,await actorFromToken((await cookies()).get(SESSION_COOKIE)?.value));
 }catch(error){if(error instanceof ServiceError)redirect(`/portal/payouts/tax?error=${error.code}`);throw error;}
 redirect("/portal/payouts/tax?saved=1");
}
