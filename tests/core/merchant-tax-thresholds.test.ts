// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: exact threshold alerts and stable report windows.
import {describe,expect,it} from "vitest";
import {merchantTaxThresholdProgress,merchantTaxThresholdStart} from "@/modules/invoicing/merchant-tax-thresholds";

describe("business threshold report boundaries (C12.38)",()=>{
 it("distinguishes no declared threshold, the exact alert boundary and a reached threshold",()=>{
  expect(merchantTaxThresholdProgress(500,0)).toEqual({state:"not_configured",remainingMinor:0,progressPpm:0});
  expect(merchantTaxThresholdProgress(799,1000)).toEqual({state:"below",remainingMinor:201,progressPpm:799000});
  expect(merchantTaxThresholdProgress(800,1000)).toEqual({state:"approaching",remainingMinor:200,progressPpm:800000});
  expect(merchantTaxThresholdProgress(1001,1000)).toEqual({state:"reached",remainingMinor:0,progressPpm:1000000});
 });
 it("keeps large exact currency amounts from rounding an approaching business into reached",()=>{
  const maximum=Number.MAX_SAFE_INTEGER;
  expect(merchantTaxThresholdProgress(maximum-1,maximum)).toEqual({state:"approaching",remainingMinor:1,progressPpm:999999});
  for(const amount of [-1,0.1,maximum+1,Number.NaN])expect(()=>merchantTaxThresholdProgress(amount,100)).toThrow();
 });
 it("anchors calendar-year reporting to UTC and leaves the caller's instant unchanged",()=>{
  const at=new Date("2026-01-01T00:00:00.000Z"),before=at.toISOString();
  expect(merchantTaxThresholdStart(at,"calendar_year").toISOString()).toBe(before);
  expect(merchantTaxThresholdStart(new Date("2026-12-31T23:59:59.999Z"),"calendar_year").toISOString()).toBe("2026-01-01T00:00:00.000Z");
  expect(at.toISOString()).toBe(before);
 });
 it("keeps the selected rolling cutoff's UTC time instead of widening the report to a whole year",()=>{
  const at=new Date("2026-11-12T18:14:25.678Z");
  expect(merchantTaxThresholdStart(at,"rolling_12_months").toISOString()).toBe("2025-11-12T18:14:25.678Z");
  expect(at.toISOString()).toBe("2026-11-12T18:14:25.678Z");
 });
});
