// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38/C11.10: a quote-only connector cannot inspect named buyer tax policy.
import {describe,expect,it} from "vitest";
import {permits,type Actor} from "@/core/service";
import {canReadNamedBuyerTax} from "@/modules/catalog/merchant-tax-buyer-authority";
describe("named buyer tax authority (C12.38)",()=>{
 it("refuses a public quote connector even though it may use that public scope",()=>{
  const actor:Actor={kind:"agent",keyName:"public-quote-only",scopes:["catalog.quoteMerchantCheckout"]};
  expect(permits(actor,"scoped","catalog.quoteMerchantCheckout","query")).toBe(true);
  expect(canReadNamedBuyerTax(actor)).toBe(false);
 });
 it("requires actual private customer-pricing authority for delegated enrichment",()=>{
  expect(canReadNamedBuyerTax({kind:"agent",keyName:"private-pricing",scopes:["catalog.resolvePrice"]})).toBe(true);
  expect(canReadNamedBuyerTax({kind:"agent",keyName:"catalog-owner",scopes:["catalog.*"]})).toBe(true);
 });
 it("does not treat a role title or an ordinary signed-in buyer as a staff grant",()=>{
  expect(canReadNamedBuyerTax({kind:"user",userId:"test-user",role:"owner",grants:[]})).toBe(false);
  expect(canReadNamedBuyerTax({kind:"anonymous"})).toBe(false);
  expect(canReadNamedBuyerTax({kind:"user",userId:"test-staff",role:"custom",grants:[{module:"catalog",access:"view"}]})).toBe(true);
 });
});
