// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import type { Metadata } from "next";
import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { z } from "zod";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { localizeCustomerHref } from "@/core/i18n/customer";
import { currentBusiness } from "@/core/settings/read";
import { myMembershipPaymentMethods } from "@/modules/subscriptions/public-signup";
import { getLocale, getT } from "../../../i18n";
import { utilityPageMetadata } from "../../utility-metadata";
import { CommercialAcceptance } from "../CommercialAcceptance";

export const dynamic="force-dynamic";
export async function generateMetadata():Promise<Metadata>{
  const t=await getT();return utilityPageMetadata({path:"memberships/review",title:t("memberships.reviewCommercial"),description:t("memberships.commercialReviewHint"),index:false});
}
export default async function ReviewMembership({searchParams}:{searchParams:Promise<{plan?:string}>}){
  const [q,t,locale,business,jar]=await Promise.all([searchParams,getT(),getLocale(),currentBusiness(),cookies()]);
  const parsed=z.uuid().safeParse(q.plan);if(!parsed.success)notFound();
  const actor=await actorFromToken(jar.get(SESSION_COOKIE)?.value);
  const href=(path:string)=>business?localizeCustomerHref(path,locale,business):path;
  const returnTo=`/memberships/review?plan=${parsed.data}`;
  const methods=actor.kind==="user"?await myMembershipPaymentMethods.call({planId:parsed.data},actor).catch(()=>[]):[];
  return <main className="mx-auto grid max-w-2xl gap-6 px-6 py-12"><h1 className="text-3xl font-semibold">{t("memberships.reviewCommercial")}</h1>
    {actor.kind==="user"?<CommercialAcceptance planId={parsed.data} requestKey={randomUUID()} locale={locale} methods={methods}/>:<a className="underline" href={href(`/portal/login?returnTo=${encodeURIComponent(returnTo)}`)}>{t("memberships.signIn")}</a>}
    <a className="underline" href={href("/memberships")}>{t("memberships.title")}</a>
  </main>;
}
