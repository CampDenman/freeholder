// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// PREPARED/UNRUN: source preservation, not real amendment/provider acceptance.
import { readFileSync } from "node:fs";
import { describe,expect,it } from "vitest";
const read=(path:string)=>readFileSync(new URL(`../../${path}`,import.meta.url),"utf8"),helper=read("src/modules/invoicing/controlled-period-amendment-parent.ts"),authority=read("src/modules/invoicing/controlled-provider-collection-authority.ts");
describe("actual activated terms parent reader",()=>{
 it("uses the genuine existing factory calendar and governing-terms readers with exact original row ancestry",()=>{
  expect(helper).toContain("await commercialBillingStart(ctx,parent)");expect(helper).toContain("await originalMerchantTerms(ctx,parent,calendar.start)");
  for(const exact of ["pending.amendment.subscriptionId!==parent.id","pending.amendment.planId!==parent.pendingPlanId","pending.amendment.termsId!==terms.id","pending.terms.subscriptionId!==parent.id","pending.terms.previousTermsId!==pending.amendment.previousTermsId","previous.subscriptionId!==parent.id","previous.revision+1!==pending.terms.revision","pending.amendment.acceptedQuoteDigest!==pending.terms.acceptedQuoteDigest"])expect(helper).toContain(exact);
  expect(helper).toContain('pending.amendment.state!=="activated"');expect(helper).toContain('pending.terms.acceptanceSource!=="amendment"');expect(helper).toContain("calendar.start<=parent.currentPeriodEnd");expect(helper).not.toMatch(/amountMinor|providerAccountId|callAsSystem|defineService|\.insert\(|\.update\(/);
 });
 it("preserves old boundary shape before any additional query and keeps all real rows in the current parent hash",()=>{
  expect(helper.indexOf("return null;")).toBeLessThan(helper.indexOf("await commercialBillingStart"));expect(helper).toContain("governingTerms:accepted,previousTerms:previous,amendment:pending.amendment");
  const parent=read("src/modules/invoicing/controlled-provider-financial-parent.ts");expect(parent).toContain("'subscription_commercial_amendments'");expect(parent).toContain("'subscription_commercial_resumptions'");
 });
 it("retains both actual date checks, current safety and final exact re-read without changing observational authority",()=>{
  expect(authority).toContain("periodAmendment=await readControlledPeriodAmendment(ctx,source)");expect(authority).toContain("await readControlledPeriodAmendment(ctx,currentTarget)");expect(authority).toContain("merchantTaxDigest(currentAmendment)!==merchantTaxDigest(periodAmendment)");
  expect(authority.split("controlledPeriodAdmission({")).toHaveLength(3);expect(authority).toContain("if(!observing){");expect(authority).toContain("if(raw.unresolvedFactIds.length)refuse()");expect(authority).toContain("history.unfinished.length||history.closures.length");expect(authority).toContain("actualDebt.pending");expect(authority).toContain("privateState?.ready");
 });
});
