// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: a remote calendar may charge only explicitly quoted original periods.
import { z } from "zod";
import { ServiceError } from "@/core/service";
import { merchantTaxDigest } from "@/modules/invoicing/merchant-tax-store";
import { periodEnd } from "./calendar";

const minor=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const digest=z.string().regex(/^[a-f0-9]{64}$/);
const reference=(prefix:string)=>z.string().regex(new RegExp(`^${prefix}_[A-Za-z0-9]{1,195}$`));
export const providerPhase = z.object({
  termsId:z.uuid(),profileId:z.uuid(),profileVersion:z.number().int().positive(),
  start:z.iso.datetime(),end:z.iso.datetime(),taxOccurredAt:z.iso.datetime(),
  currency:z.string().regex(/^[A-Z]{3}$/),interval:z.enum(["day","week","month","year"]),intervalCount:z.number().int().positive().max(52),
  periodAmountMinor:minor,setupFeeMinor:minor,taxMinor:minor,totalMinor:minor,
  applicationFeeMinor:minor,siteFeeBps:z.number().int().min(0).max(10000),
  taxQuoteDigest:digest,phaseDigest:digest,
}).strict();
export type ProviderPhase=z.infer<typeof providerPhase>;

/** This is a retained, authenticated adapter observation, never a caller input.
 * The observer must compare actual price/currency/calendar/recipient/fee policy
 * and metadata against the admitted full request before recording it. */
export const providerPhaseInventory=z.object({
  version:z.literal(1),operationId:z.uuid(),requestDigest:digest,
  providerScheduleRef:reference("sub_sched"),providerSubscriptionRef:reference("sub").nullable(),providerCustomerRef:reference("cus"),
  providerPlatformAccountId:reference("acct"),chargeAccountId:reference("acct").nullable(),
  recipientAccountId:reference("acct"),settlementMerchantAccountId:reference("acct"),
  providerApiVersion:z.literal("2026-10-28.endive"),
  status:z.enum(["active","not_started","completed","canceled","released"]),
  endBehavior:z.literal("cancel"),complete:z.literal(true),
  currentPhaseStart:z.iso.datetime().nullable(),
  phases:z.array(providerPhase.extend({providerPriceRef:reference("price")})).min(1).max(10),
}).strict().superRefine((value, ctx) => {
  if (value.status === "active" && (!value.providerSubscriptionRef || !value.currentPhaseStart || !value.phases.some(phase => phase.start === value.currentPhaseStart))) {
    ctx.addIssue({ code: "custom", message: "An active original schedule requires its actual linked subscription and current phase." });
  }
  if (value.status === "not_started" && (value.providerSubscriptionRef !== null || value.currentPhaseStart !== null)) {
    ctx.addIssue({ code: "custom", message: "An original future schedule cannot invent a linked subscription or started phase." });
  }
});

/** The actual returned customer must remain the originally admitted one;
 * another valid customer ID is not an equivalent billing namespace. */
export function originalPhaseCustomerMatches(inventory: z.infer<typeof providerPhaseInventory>, expected: unknown): boolean {
  return typeof expected === "string" && /^cus_[A-Za-z0-9]{1,195}$/.test(expected) && inventory.providerCustomerRef === expected;
}

export function exactProviderDate(value:string):Date{
  const date=new Date(value);
  if(!Number.isFinite(date.getTime())||date.toISOString()!==value||date.getUTCMilliseconds()!==0){
    throw new ServiceError("conflict","The original provider calendar needs exact accepted whole-second boundaries; it cannot be silently rounded.");
  }
  return date;
}

export function originalPhaseFee(amounts:readonly number[],bps:number):number{
  if(!Number.isInteger(bps)||bps<0||bps>10000||amounts.some(amount=>!Number.isSafeInteger(amount)||amount<0))throw new ServiceError("validation","The original fee inputs are invalid.");
  const total=amounts.reduce((sum,amount)=>sum+BigInt(amount)*BigInt(bps)/10000n,0n);
  if(total>BigInt(Number.MAX_SAFE_INTEGER))throw new ServiceError("validation","The original commission exceeds the supported amount.");
  return Number(total);
}

export function freezeProviderPhase(input:Omit<ProviderPhase,"phaseDigest">):ProviderPhase{
  input=providerPhase.omit({phaseDigest:true}).parse(input);
  const start=exactProviderDate(input.start),end=exactProviderDate(input.end);
  if(input.taxOccurredAt!==input.start||periodEnd(start,input.interval,input.intervalCount).getTime()!==end.getTime())throw new ServiceError("conflict","The quoted tax date and period do not match this original calendar.");
  const total=BigInt(input.periodAmountMinor)+BigInt(input.setupFeeMinor)+BigInt(input.taxMinor);
  if(total>BigInt(Number.MAX_SAFE_INTEGER)||Number(total)!==input.totalMinor||input.applicationFeeMinor!==originalPhaseFee([input.periodAmountMinor,input.setupFeeMinor],input.siteFeeBps))throw new ServiceError("conflict","The actual period quote differs from its original net amount, tax or per-line commission.");
  return providerPhase.parse({...input,phaseDigest:merchantTaxDigest({version:1,kind:"original-provider-phase",...input})});
}

export function assertPhaseHorizon(phases:readonly ProviderPhase[]):void{
  if(!phases.length||phases.length>10)throw new ServiceError("conflict","The provider horizon must contain one to ten completely quoted periods.");
  for(let index=0;index<phases.length;index++){
    const phase=phases[index]!,{phaseDigest,...body}=phase;
    if(freezeProviderPhase(body).phaseDigest!==phaseDigest||index>0&&phases[index-1]!.end!==phase.start)throw new ServiceError("conflict","The original phase horizon is incomplete, altered or discontinuous.");
    if(index>0&&phase.setupFeeMinor!==0)throw new ServiceError("conflict","The original setup fee cannot recur in another provider phase.");
    if(index>0&&["currency","interval","intervalCount","periodAmountMinor","profileId","profileVersion","termsId","siteFeeBps"].some(key=>phase[key as keyof ProviderPhase]!==phases[0]![key as keyof ProviderPhase]))throw new ServiceError("conflict","A provider horizon cannot silently adopt another agreement, net price or business revision.");
  }
}
