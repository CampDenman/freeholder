// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { expect, it } from "vitest";
import { assertPhaseHorizon, exactProviderDate, freezeProviderPhase, originalPhaseFee } from "@/modules/subscriptions/provider-phase-contract";
import { newProviderCalendarStart } from "@/modules/subscriptions/calendar";

const input={termsId:"00000000-0000-4000-8000-000000000081",profileId:"00000000-0000-4000-8000-000000000082",profileVersion:1,
  start:"2027-06-01T00:00:00.000Z",end:"2027-07-01T00:00:00.000Z",taxOccurredAt:"2027-06-01T00:00:00.000Z",
  currency:"CAD",interval:"month" as const,intervalCount:1,periodAmountMinor:2000,setupFeeMinor:0,taxMinor:100,totalMinor:2100,
  applicationFeeMinor:20,siteFeeBps:100,taxQuoteDigest:"a".repeat(64)};
const later={...input,start:input.end,end:"2027-08-01T00:00:00.000Z",taxOccurredAt:input.end,taxMinor:200,totalMinor:2200,taxQuoteDigest:"b".repeat(64)};

it("keeps each dated gross quote separate while commission stays on original net merchandise",()=>{
  const first=freezeProviderPhase(input),second=freezeProviderPhase(later);
  expect(()=>assertPhaseHorizon([first,second])).not.toThrow();
  expect(first.totalMinor).toBe(2100);expect(second.totalMinor).toBe(2200);
  expect(first.applicationFeeMinor).toBe(20);expect(second.applicationFeeMinor).toBe(20);
  expect(first.phaseDigest).not.toBe(second.phaseDigest);
});

it("refuses a gap instead of treating an unquoted period as covered",()=>{
  const skipped=freezeProviderPhase({...later,start:"2027-08-01T00:00:00.000Z",end:"2027-09-01T00:00:00.000Z",taxOccurredAt:"2027-08-01T00:00:00.000Z"});
  expect(()=>assertPhaseHorizon([freezeProviderPhase(input),skipped])).toThrow(/discontinuous/);
});

it("refuses to release an altered retained phase under its original digest",()=>{
  const first=freezeProviderPhase(input);
  expect(()=>assertPhaseHorizon([{...first,taxMinor:101,totalMinor:2101}])).toThrow(/altered/);
});

it("requires explicit stop and amendment rather than adopting another original net price",()=>{
  const changed=freezeProviderPhase({...later,periodAmountMinor:3000,totalMinor:3200,applicationFeeMinor:30});
  expect(()=>assertPhaseHorizon([freezeProviderPhase(input),changed])).toThrow(/net price/);
});

it("never repeats an already accepted setup component in a later phase",()=>{
  const second=freezeProviderPhase({...later,setupFeeMinor:500,totalMinor:2700,applicationFeeMinor:25});
  expect(()=>assertPhaseHorizon([freezeProviderPhase(input),second])).toThrow(/setup fee/);
});

it("bounds the actual provider phase count without dropping excess evidence",()=>{
  expect(()=>assertPhaseHorizon(Array.from({length:11},()=>freezeProviderPhase(input)))).toThrow(/one to ten/);
});

it("refuses silent rounding of an original billing boundary",()=>{
  expect(()=>exactProviderDate("2027-06-01T00:00:00.001Z")).toThrow(/silently rounded/);
  expect(()=>freezeProviderPhase({...input,taxOccurredAt:"2027-06-02T00:00:00.000Z"})).toThrow(/tax date/);
});

it("chooses provider precision only at a new admission before an original boundary exists",()=>{
  const moment=new Date("2027-06-01T00:00:00.999Z");
  expect(newProviderCalendarStart(moment).toISOString()).toBe("2027-06-01T00:00:00.000Z");
  expect(moment.toISOString()).toBe("2027-06-01T00:00:00.999Z");
});

it("floors each original line's fee exactly even beyond safe floating-point multiplication",()=>{
  expect(originalPhaseFee([101,101],50)).toBe(0);
  expect(originalPhaseFee([Number.MAX_SAFE_INTEGER],9999)).toBe(Number(BigInt(Number.MAX_SAFE_INTEGER)*9999n/10000n));
});
