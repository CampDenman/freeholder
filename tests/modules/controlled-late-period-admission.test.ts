// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// PREPARED/UNRUN: pure admission consistency, not real amendment/DB acceptance.
import { describe,expect,it } from "vitest";
import { controlledPeriodAdmission } from "@/modules/invoicing/controlled-target-financial-policy";
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`,start="2026-12-10T00:00:00.000Z",end="2027-01-10T00:00:00.000Z",oldStart="2026-11-01T00:00:00.000Z",oldEnd="2026-12-01T00:00:00.000Z",sha="a".repeat(64);
function vector():Parameters<typeof controlledPeriodAdmission>[0]{return{subscriptionId:id(1),sourceId:`${id(1)}:${start}`,now:new Date("2026-12-05T00:00:00.000Z"),pay:false,parentStart:oldStart,parentEnd:oldEnd,trialEnd:null,originalStart:oldStart,originalEnd:oldEnd,originalTrialEnd:null,periodStart:start,periodEnd:end,credits:[0,0,0,0],governingTermsId:id(2),governingAcceptedQuoteDigest:sha,pendingPlanId:id(3),
 activatedAmendment:{subscriptionId:id(1),termsId:id(2),previousTermsId:id(4),planId:id(3),state:"activated",activatedAt:"2026-12-02T00:00:00.000Z",effectivePeriodStart:start,acceptedQuoteDigest:sha}};}
describe("exact activated amendment's later controlled service start",()=>{
 it("permits preparation of the actual accepted later period without early cash collection",()=>{const v=vector();expect(controlledPeriodAdmission(v)).toBe(true);expect(controlledPeriodAdmission({...v,pay:true})).toBe(false);expect(controlledPeriodAdmission({...v,pay:true,now:new Date(start)})).toBe(true);});
 it("does not infer a later date from a current plan, equal amount or merely accepted terms",()=>{const v=vector();delete v.activatedAmendment;expect(controlledPeriodAdmission(v)).toBe(false);});
 it.each(["subscription","terms","plan","quote","previous","pending","unactivated","futureActivation","start"] as const)("refuses mismatched %s ancestry",change=>{const v=vector(),a=v.activatedAmendment;if(!a)throw Error("Use actual-shaped amendment evidence.");
  if(change==="subscription")a.subscriptionId=id(9);if(change==="terms")a.termsId=id(9);if(change==="plan")a.planId=id(9);if(change==="quote")a.acceptedQuoteDigest="b".repeat(64);if(change==="previous")a.previousTermsId=a.termsId;
  if(change==="pending")a.state="pending_stop";if(change==="unactivated")a.activatedAt=null;if(change==="futureActivation")a.activatedAt="2026-12-06T00:00:00.000Z";if(change==="start")a.effectivePeriodStart="2026-12-11T00:00:00.000Z";expect(controlledPeriodAdmission(v)).toBe(false);
 });
 it("retains the real unchanged original parent window, source identity and zero-credit requirements",()=>{
  const v=vector();for(const changed of [{originalEnd:start},{parentEnd:start},{sourceId:`${id(9)}:${start}`},{credits:[0,0,1,0]}])expect(controlledPeriodAdmission({...v,...changed})).toBe(false);
 });
 it("preserves the accepted trial end and never bills the trial window",()=>{const v=vector();expect(controlledPeriodAdmission({...v,trialEnd:"2026-12-11T00:00:00.000Z",originalTrialEnd:"2026-12-11T00:00:00.000Z"})).toBe(false);expect(controlledPeriodAdmission({...v,trialEnd:oldEnd,originalTrialEnd:null})).toBe(false);});
 it("refuses expired service and invalid date strings without moving accepted boundaries",()=>{const v=vector();expect(controlledPeriodAdmission({...v,now:new Date(end),pay:true})).toBe(false);expect(controlledPeriodAdmission({...v,periodStart:"2026-12-10",sourceId:`${id(1)}:2026-12-10`})).toBe(false);});
 it("leaves original next-boundary behavior unchanged with no amendment evidence",()=>{const v=vector();delete v.activatedAmendment;expect(controlledPeriodAdmission({...v,periodStart:oldEnd,sourceId:`${id(1)}:${oldEnd}`})).toBe(true);});
});
