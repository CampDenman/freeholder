// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Original money recovery remains in invoicing even when subscriptions is off
// and when genuine provider money has no canonical invoice/payment yet.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { hasModuleAccess } from "@/core/service";
import { Card,CardBody,CardHeader,Callout } from "@/ui/primitives";
import { controlledProviderRecoveryPlan,controlledProviderResourceStatus } from "@/modules/subscriptions/controlled-provider-stop";
import { ControlledProviderRecovery } from "../../../../../components/ControlledProviderRecovery";
import { getT,getLocale } from "../../../../../i18n";
import { requireStaffActor } from "../../../guard";
export const dynamic="force-dynamic";
export const metadata:Metadata={robots:{index:false,follow:false}};
export default async function ControlledMoneyRecoveryPage({params,searchParams}:{params:Promise<{id:string}>;searchParams:Promise<{controlledResult?:string}>}){
 const actor=await requireStaffActor("invoicing"),{id}=await params;if(!/^[a-f0-9-]{36}$/i.test(id))notFound();
 const[t,locale,query]=await Promise.all([getT(),getLocale(),searchParams]),destination=`/admin/invoices/subscriptions/${id}`;
 const allowed=hasModuleAccess(actor,"invoicing","manage")&&actor.kind==="user"&&!actor.keyScopes,fresh=actor.kind==="user"&&actor.security?.stepUpValid!==false;
 const data=allowed&&fresh?await Promise.all([controlledProviderRecoveryPlan.call({subscriptionId:id},actor),controlledProviderResourceStatus.call({subscriptionId:id},actor)]):null;
 return <div className="grid gap-6"><h1 className="text-xl font-bold tracking-tight">{t("subscriptions.controlled.title")}</h1>
  {query.controlledResult?<Callout tone={query.controlledResult==="saved"?"success":"danger"}>{t(query.controlledResult==="saved"?"subscriptions.reader.saved":"subscriptions.reader.failed")}</Callout>:null}
  {data?<ControlledProviderRecovery subscriptionId={id} calls={data[0]} resources={data[1]} locale={locale} moneyRecovery/>:allowed?<Card><CardHeader title={t("subscriptions.controlled.title")}/><CardBody><a className="text-accent underline" href={`/security/verify?returnTo=${encodeURIComponent(destination)}`}>{t("subscriptions.setup.verify")}</a></CardBody></Card>:null}
 </div>;
}
