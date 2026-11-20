// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import {describe,expect,it} from "vitest";
import {originalQuotaChargeDecision} from "@/core/media/original-quota-evidence";
const original="00000000-0000-4000-8000-000000000001",later="00000000-0000-4000-8000-000000000002";
describe("C10.32/C11.08 actual late original quota charge authority",()=>{
 it("restores a missing exact-original charge without inventing a new admission token",()=>expect(originalQuotaChargeDecision(original,6,undefined,true)).toBe("insert"));
 it("preserves the already held exact-original charge",()=>expect(originalQuotaChargeDecision(original,6,{bytes:6,pendingToken:original,lastSettledToken:null},true)).toBe("retain"));
 it("reopens only the exact originally settled token after a genuine late physical fact",()=>expect(originalQuotaChargeDecision(original,6,{bytes:6,pendingToken:null,lastSettledToken:original},true)).toBe("restore"));
 it("restores a smaller original charge to its immutable admitted bound without reducing a larger charge",()=>{expect(originalQuotaChargeDecision(original,6,{bytes:0,pendingToken:original,lastSettledToken:original},true)).toBe("restore");expect(originalQuotaChargeDecision(original,6,{bytes:9,pendingToken:original,lastSettledToken:original},true)).toBe("retain");});
 it("preserves conflicting pending/settled rows and requires namespace refusal rather than rebinding another original token",()=>{for(const row of [{bytes:6,pendingToken:later,lastSettledToken:original},{bytes:6,pendingToken:null,lastSettledToken:later},{bytes:6,pendingToken:null,lastSettledToken:null}]){const before={...row};expect(originalQuotaChargeDecision(original,6,row,true)).toBe("conflict");expect(row).toEqual(before);}});
 it("refuses an inexact or invalid byte bound instead of inventing available capacity",()=>{for(const bytes of [-1,Infinity,Number.MAX_SAFE_INTEGER+1])expect(originalQuotaChargeDecision(original,bytes,undefined,true)).toBe("conflict");});
});
