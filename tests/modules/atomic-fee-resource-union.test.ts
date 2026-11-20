// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// PREPARED/UNRUN: exact physical owners across the two existing journals.
import {describe,expect,it} from "vitest";
import {atomicFeeResourceUnion,type AtomicFeeResource} from "@/modules/invoicing/atomic-fee-resource-union";
const resource:AtomicFeeResource={ledger:"original_auxiliary",paymentId:"11111111-1111-4111-8111-111111111111",receiptId:"22222222-2222-4222-8222-222222222222",operationId:"33333333-3333-4333-8333-333333333333",platform:"acct_originalPlatform",feeRef:"fee_original",chargeRef:"ch_original",account:"acct_originalSeller",providerRef:"fr_actual1",amountMinor:1,currency:"CAD",evidenceDigest:"a".repeat(64)};
describe("exact original physical fee union",()=>{
 it("counts repeated genuine observations under one original owner once and keeps both witnesses",()=>{const result=atomicFeeResourceUnion([resource,{...resource,evidenceDigest:"b".repeat(64)}]);expect(result.returnedMinor).toBe(1);expect(result.resources).toHaveLength(1);expect(result.resources[0]?.evidenceDigests).toEqual(["a".repeat(64),"b".repeat(64)]);});
 it.each(["ledger","operationId","paymentId","receiptId","feeRef","chargeRef","account","amountMinor","currency"] as const)("refuses a physical return with conflicting %s ownership",key=>{const changes={ledger:"merchant_fee",operationId:"44444444-4444-4444-8444-444444444444",paymentId:"44444444-4444-4444-8444-444444444444",receiptId:"44444444-4444-4444-8444-444444444444",feeRef:"fee_foreign",chargeRef:"ch_foreign",account:"acct_foreignSeller",amountMinor:2,currency:"USD"};expect(()=>atomicFeeResourceUnion([resource,{...resource,[key]:changes[key]}])).toThrow();});
 it("refuses two different physical resources for one original operation",()=>{expect(()=>atomicFeeResourceUnion([resource,{...resource,providerRef:"fr_second"}])).toThrow();});
 it("keeps distinct real resources with equal amounts and stable ordering",()=>{const other={...resource,operationId:"44444444-4444-4444-8444-444444444444",providerRef:"fr_actual2"};expect(atomicFeeResourceUnion([resource,other])).toEqual(atomicFeeResourceUnion([other,resource]));expect(atomicFeeResourceUnion([resource,other]).returnedMinor).toBe(2);});
 it("refuses truncated input instead of silently taking the first5000",()=>{expect(()=>atomicFeeResourceUnion(Array.from({length:5001},()=>resource))).toThrow();});
 it("refuses unsafe actual minor-unit aggregation",()=>{expect(()=>atomicFeeResourceUnion([{...resource,amountMinor:Number.MAX_SAFE_INTEGER},{...resource,providerRef:"fr_actual2",amountMinor:1}])).toThrow();});
});
