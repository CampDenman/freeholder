// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: site business policy uses the same scoped, audited service as the API.
"use server";
import {redirect} from "next/navigation";
import {ServiceError} from "@/core/service";
import {merchantTaxFormValues} from "@/modules/invoicing/merchant-tax-form";
import {saveSiteMerchantTaxProfile} from "@/modules/invoicing/merchant-tax-profiles";
import {reviewSiteMerchantTaxExemption} from "@/modules/invoicing/merchant-tax-exemptions";
import {merchantTaxExemptionReviewValues} from "@/modules/invoicing/merchant-tax-exemption-form";
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
export async function reviewSiteTaxExemptionAction(form:FormData):Promise<void>{
 try{
  const actor=await requireStaffActor("invoicing","manage");
  const parsed=reviewSiteMerchantTaxExemption.def.input.safeParse(merchantTaxExemptionReviewValues(form));
  if(!parsed.success)throw new ServiceError("validation","Review the original customer evidence and expiry.");
  await reviewSiteMerchantTaxExemption.call(parsed.data,actor);
 }catch(error){if(error instanceof ServiceError)redirect(`/admin/invoices/tax/business?reviewError=${error.code}`);throw error;}
 redirect("/admin/invoices/tax/business?reviewed=1");
}
