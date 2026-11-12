// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: explicit site business identity and versioned tax declaration.
import {hasModuleAccess} from "@/core/service";
import {loadMerchantTaxEditor,MerchantTaxEditor,type MerchantTaxEditorQuery} from "@/ui/MerchantTaxEditor";
import {getLocale,getT} from "../../../../../i18n";
import {requireStaffActor} from "../../../guard";
import {saveSiteTaxAction} from "./actions";
export const dynamic="force-dynamic";
export default async function SiteBusinessTaxPage({searchParams}:{searchParams:Promise<MerchantTaxEditorQuery>}){
 const actor=await requireStaffActor("invoicing");
 const[t,locale,query]=await Promise.all([getT(),getLocale(),searchParams]);
 const data=await loadMerchantTaxEditor(actor,true,query);
 return<div className="grid gap-6"><div><a href="/admin/invoices/tax" className="text-sm underline">{t("merchantTax.backToTax")}</a><h1 className="mt-3 text-xl font-semibold">{t("merchantTax.siteTitle")}</h1></div><MerchantTaxEditor data={data} query={query} path="/admin/invoices/tax/business" site action={saveSiteTaxAction} t={t} locale={locale} canManage={hasModuleAccess(actor,"invoicing","manage")}/></div>;
}
