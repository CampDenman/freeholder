// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { actOnMyRecord } from "@/core/portal/record-service";
import { safeCustomerReturnPath } from "@/core/portal/return-path";
import { currentBusiness } from "@/core/settings/read";
import { localizeCustomerHref } from "@/core/i18n/customer";
import { getLocale } from "../../../../../i18n";
export async function portalRecordAction(form:FormData){
  const field=(k:string)=>(() => { const value=form.get(k); return typeof value === "string" ? value : ""; })();
  const section=field("section"),id=field("id");
  const path=safeCustomerReturnPath(`/portal/records/${section}/${id}`);
  const business=await currentBusiness(),locale=await getLocale();
  const href=(p:string)=>business?localizeCustomerHref(p,locale,business):p;
  let result;
  try {result=await actOnMyRecord.call({section,id,action:field("action") as "cancel",name:field("name")||undefined,reason:field("reason")||undefined},await actorFromToken((await cookies()).get(SESSION_COOKIE)?.value));}
  catch {redirect(href(`${path}?error=1`));}
  revalidatePath("/portal","layout");
  redirect(href(result.href??`${path}?saved=1`));
}
