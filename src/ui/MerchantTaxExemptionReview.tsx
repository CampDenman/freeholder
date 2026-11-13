// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: only the authorized business's private evidence reaches this view.
import type {Translate} from "@/core/i18n";
import type {siteMerchantTaxExemptions} from "@/modules/invoicing/merchant-tax-exemptions";
import {Button,Field,Input} from "./primitives";
type Rows=Awaited<ReturnType<typeof siteMerchantTaxExemptions.call>>["rows"];
export function MerchantTaxExemptionReview({rows,action,canManage,t}:{rows:Rows;action:(form:FormData)=>Promise<void>;canManage:boolean;t:Translate}){
 if(!rows.length)return <p className="text-sm text-ink-muted">{t("tax.exemptions.empty")}</p>;
 return <ul className="grid list-none gap-6 p-0">{rows.map(row=><li key={row.id} className="min-w-0 rounded-md border border-rule p-4">
  <p className="font-medium">{row.customerName??t("tax.exemption.contact")} · {row.zoneName}</p>
  <p className="text-sm">{t(`tax.exemption.kind.${row.kind}`)} · {t(`tax.exemption.status.${row.status==="valid"&&row.expiresAt&&row.expiresAt<new Date()?"expired":row.status}`)}</p>
  <p className="mt-2 text-xs text-ink-muted">{t("merchantTax.exemption.evidence")}</p><p className="break-words whitespace-pre-wrap text-sm"><bdi>{row.certificateRef??t("merchantTax.exemption.noEvidence")}</bdi></p>
  {canManage&&row.status==="pending"?<form action={action} className="mt-4 grid gap-3">
   <input type="hidden" name="id" value={row.id}/><input type="hidden" name="expectedStatus" value={row.status}/><input type="hidden" name="decision" value="valid"/>
   <Field label={t("merchantTax.exemption.expiryUtc")} htmlFor={`exemption-${row.id}-expiry`}><Input id={`exemption-${row.id}-expiry`} name="expiresAt" type="datetime-local"/></Field>
   <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="confirmEvidence" required className="mt-1"/><span>{t("merchantTax.exemption.confirmEvidence")}</span></label>
   <div><Button type="submit">{t("merchantTax.exemption.approve")}</Button></div>
  </form>:null}
  {canManage&&["pending","valid"].includes(row.status)?<form action={action} className="mt-3">
   <input type="hidden" name="id" value={row.id}/><input type="hidden" name="expectedStatus" value={row.status}/><input type="hidden" name="decision" value="revoked"/>
   <Button type="submit" variant="quiet">{t(row.status==="pending"?"merchantTax.exemption.decline":"merchantTax.exemption.revoke")}</Button>
  </form>:null}
 </li>)}</ul>;
}
