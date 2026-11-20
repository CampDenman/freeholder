// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// PREPARED/UNRUN: actual provider/parent admission remains independently required.
import { describe,expect,it } from "vitest";
import { controlledReviewedPeriodWindow } from "@/modules/invoicing/controlled-target-financial-policy";
const start="2026-12-01T00:00:00.000Z",end="2027-01-01T00:00:00.000Z",old="2026-11-01T00:00:00.000Z";
function vector(){return{kind:"period" as const,beforeUpdate:false,periodStart:start,periodEnd:end,expectedStart:old,expectedEnd:start,principalMinor:1000,forecasts:[{proration:false,amountMinor:1000,periodStart:start,periodEnd:end}]};}
describe("exact reviewed normal-period bank rollover",()=>{
 it("permits only the full-NET window actually present in the accepted native forecast",()=>expect(controlledReviewedPeriodWindow(vector())).toBe(true));
 it.each(["proration","before-update","amount","start","end","prorated-forecast","missing"] as const)("refuses %s without broadening the original expected window",change=>{const v=vector();const actual=change==="proration"?{...v,kind:"proration" as const}:change==="before-update"?{...v,beforeUpdate:true}:change==="amount"?{...v,principalMinor:1001}:change==="start"?{...v,periodStart:old}:change==="end"?{...v,periodEnd:start}:change==="prorated-forecast"?{...v,forecasts:v.forecasts.map(row=>({...row,proration:true}))}:{...v,forecasts:[]};expect(controlledReviewedPeriodWindow(actual)).toBe(false);});
 it("keeps the exact original expected window valid without any forecast",()=>{const v=vector();expect(controlledReviewedPeriodWindow({...v,kind:"proration",beforeUpdate:true,periodStart:v.expectedStart,periodEnd:v.expectedEnd,forecasts:[]})).toBe(true);});
});
