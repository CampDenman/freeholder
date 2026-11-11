// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use server";
import {cookies} from "next/headers";
import {redirect} from "next/navigation";
import {revalidatePath} from "next/cache";
import {SESSION_COOKIE} from "@/core/auth/sessions";
import {actorFromToken} from "@/core/http/actor";
import {currentBusiness} from "@/core/settings/read";
import {localizeCustomerHref} from "@/core/i18n/customer";
import {requestMyReturn} from "@/modules/catalog/customer-returns";
import {getLocale} from "../../../../../i18n";
export async function customerReturnAction(form:FormData){
 const field=(name:string)=>{const value=form.get(name);return typeof value==="string"?value:"";};
 const orderId=field("orderId"),business=await currentBusiness(),locale=await getLocale();
 const path=`/portal/orders/${encodeURIComponent(orderId)}/returns`;
 const href=(p:string)=>business?localizeCustomerHref(p,locale,business):p;
 try{
  const items=[...form.entries()].filter(([key,value])=>key.startsWith("quantity:")&&typeof value==="string"&&Number(value)>0).map(([key,value])=>({orderItemId:key.slice(9),quantity:Number(value)}));
  await requestMyReturn.call({orderId,reason:field("reason"),items},await actorFromToken((await cookies()).get(SESSION_COOKIE)?.value));
 }catch{redirect(href(`${path}?error=1`));}
 revalidatePath("/portal","layout");
 redirect(href(`${path}?saved=1`));
}
