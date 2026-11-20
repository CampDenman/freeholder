// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// PREPARED/UNRUN: a planned UUID is authenticated evidence, never row birth.
import {describe,expect,it} from "vitest";
import type {AtomicCreditFeeDeclaration} from "@/modules/invoicing/atomic-credit-fee-declaration-contract";
import {ATOMIC_CREDIT_FEE_DECLARATION_PROTOCOL} from "@/modules/invoicing/atomic-credit-fee-protocol";
import {signAtomicCreditFeeDeclaration,verifiedAtomicCreditFeeDeclaration} from "@/modules/invoicing/atomic-credit-fee-declaration-proof";
const id=(n:number)=>`00000000-0000-4000-8000-${n.toString().padStart(12,"0")}`;
const createdAt=new Date("2026-11-14T00:00:00Z"),key="fictional-private-B-declaration-key",sha="a".repeat(64);
function body():Omit<AtomicCreditFeeDeclaration,"digest"|"authentication">{return{protocol:ATOMIC_CREDIT_FEE_DECLARATION_PROTOCOL,quoteId:id(1),resourceId:id(2),subscriptionId:id(3),plannedProrationId:id(4),originalInvoiceId:id(5),originalInvoiceLineId:id(6),
 fundings:[{fundingId:id(7),sourcePaymentId:id(8),sourceApplicationId:null,amountMinor:4199,feeEvidenceDigest:sha}]};}
describe("private signed planned B funding declaration",()=>{
 it("binds the exact server plan and permits original credential rotation",()=>{const row=signAtomicCreditFeeDeclaration(body(),createdAt,key);expect(verifiedAtomicCreditFeeDeclaration(row,createdAt,["previous-unrelated-key",key])).toBe(true);});
 it("binds quote birth independently of the economic digest",()=>{const row=signAtomicCreditFeeDeclaration(body(),createdAt,key);expect(verifiedAtomicCreditFeeDeclaration(row,new Date("2026-11-14T00:00:01Z"),[key])).toBe(false);});
 it("refuses foreign quote, planned proration, invoice and original line under the old MAC",()=>{const row=signAtomicCreditFeeDeclaration(body(),createdAt,key);for(const field of ["quoteId","plannedProrationId","originalInvoiceId","originalInvoiceLineId"] as const)expect(verifiedAtomicCreditFeeDeclaration({...row,[field]:id(20)},createdAt,[key])).toBe(false);});
 it("refuses nested planned funding, original application and fee witness substitution",()=>{const row=signAtomicCreditFeeDeclaration(body(),createdAt,key),first=row.fundings[0];if(!first)throw new Error("fixture funding missing");
  for(const changed of [{...first,fundingId:id(21)},{...first,sourceApplicationId:id(22)},{...first,feeEvidenceDigest:"b".repeat(64)},{...first,amountMinor:4200}])expect(verifiedAtomicCreditFeeDeclaration({...row,fundings:[changed]},createdAt,[key])).toBe(false);});
 it("rejects even freshly signed duplicate planned births and duplicate original source tuples",()=>{const initial=body(),first=initial.fundings[0];if(!first)throw new Error("fixture funding missing");
  for(const extra of [{...first,sourcePaymentId:id(23)},{...first,fundingId:id(24)}])expect(verifiedAtomicCreditFeeDeclaration(signAtomicCreditFeeDeclaration({...initial,fundings:[first,extra]},createdAt,key),createdAt,[key])).toBe(false);});
 it("refuses unsafe aggregate principal without adopting an equal-amount source",()=>{const initial=body(),first=initial.fundings[0];if(!first)throw new Error("fixture funding missing");const row=signAtomicCreditFeeDeclaration({...initial,fundings:[{...first,amountMinor:Number.MAX_SAFE_INTEGER},{...first,fundingId:id(25),sourcePaymentId:id(26),amountMinor:1}]},createdAt,key);expect(verifiedAtomicCreditFeeDeclaration(row,createdAt,[key])).toBe(false);});
 it("refuses unknown public authority fields and a foreign MAC key",()=>{const row=signAtomicCreditFeeDeclaration(body(),createdAt,key);expect(verifiedAtomicCreditFeeDeclaration({...row,allowed:true},createdAt,[key])).toBe(false);expect(verifiedAtomicCreditFeeDeclaration(row,createdAt,["foreign-key"])).toBe(false);});
});
