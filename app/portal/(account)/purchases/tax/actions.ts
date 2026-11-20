// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: browser credentials stay in private cookies; services own decisions.
"use server";
import {cookies} from "next/headers";
import {redirect} from "next/navigation";
import {SESSION_COOKIE} from "@/core/auth/sessions";
import {actorFromToken} from "@/core/http/actor";
import {ServiceError} from "@/core/service";
import {requestMerchantTaxExemption,withdrawMerchantTaxExemption} from "@/modules/invoicing/merchant-tax-exemptions";
import {readShopperCart} from "../../../../(public)/shopper-cart";
const path="/portal/purchases/tax";
function text(form:FormData,name:string){const value=form.get(name);return typeof value==="string"?value.trim():"";}
export async function requestCustomerTaxExemptionAction(form:FormData):Promise<void>{
 try{
  const credential=await readShopperCart();
  if(!credential)throw new ServiceError("conflict","Open your own cart before requesting an exemption.");
  const selected=text(form,"business");
  const parsed=requestMerchantTaxExemption.def.input.safeParse({cartId:credential.cartId,cartToken:credential.token,sellerUserId:selected==="site"?null:selected,
   destination:{country:text(form,"country"),region:text(form,"region"),postalCode:text(form,"postalCode"),city:text(form,"city")},kind:text(form,"kind"),certificateRef:text(form,"certificateRef")});
  if(!parsed.success)throw new ServiceError("validation","Review the destination and actual customer evidence.");
  await requestMerchantTaxExemption.call(parsed.data,await actorFromToken((await cookies()).get(SESSION_COOKIE)?.value));
 }catch(error){if(error instanceof ServiceError)redirect(`${path}?error=${error.code}`);throw error;}
 redirect(`${path}?requested=1`);
}
export async function withdrawCustomerTaxExemptionAction(form:FormData):Promise<void>{
 try{
  const parsed=withdrawMerchantTaxExemption.def.input.safeParse({id:text(form,"id")});
  if(!parsed.success)throw new ServiceError("validation","Choose your own pending request.");
  await withdrawMerchantTaxExemption.call(parsed.data,await actorFromToken((await cookies()).get(SESSION_COOKIE)?.value));
 }catch(error){if(error instanceof ServiceError)redirect(`${path}?error=${error.code}`);throw error;}
 redirect(`${path}?withdrawn=1`);
}
