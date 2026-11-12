// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: site business policy uses the same scoped, audited service as the API.
"use server";
import {redirect} from "next/navigation";
import {ServiceError} from "@/core/service";
import {merchantTaxFormValues} from "@/modules/invoicing/merchant-tax-form";
import {saveSiteMerchantTaxProfile} from "@/modules/invoicing/merchant-tax-profiles";
import {requireStaffActor} from "../../../guard";
export async function saveSiteTaxAction(form:FormData):Promise<void>{
 try{
  const actor=await requireStaffActor("invoicing","manage");
  const parsed=saveSiteMerchantTaxProfile.def.input.safeParse({...merchantTaxFormValues(form),liability:"platform"});
  if(!parsed.success)throw new ServiceError("validation","Review the site business tax declaration fields before saving.");
  await saveSiteMerchantTaxProfile.call(parsed.data,actor);
 }catch(error){if(error instanceof ServiceError)redirect(`/admin/invoices/tax/business?error=${error.code}`);throw error;}
 redirect("/admin/invoices/tax/business?saved=1");
}
