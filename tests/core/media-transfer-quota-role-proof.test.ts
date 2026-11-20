// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// PREPARED / UNRUN. Accounting shape alone grants no physical authority.
import {describe,expect,it} from "vitest";
import {transferQuotaReleaseDecision} from "@/core/media/transfer-quota-proof";
import {originalQuotaSettlement} from "@/core/media/original-recovery-quota";
const token="00000000-0000-4000-8000-000000000081",other="00000000-0000-4000-8000-000000000082";
describe("exact original quota token accounting after independent physical proof",()=>{
 it("keeps an actual pending original reservation until its own release",()=>expect(transferQuotaReleaseDecision(token,64,{bytes:64,pendingToken:token,lastSettledToken:null},[token])).toBe("release"));
 it("recognizes only exact retained zero-charge idempotency",()=>expect(transferQuotaReleaseDecision(token,64,{bytes:0,pendingToken:null,lastSettledToken:token},[token])).toBe("already_released"));
 it("refuses another pending token even if key, size and settled token appear equal",()=>expect(()=>transferQuotaReleaseDecision(token,64,{bytes:64,pendingToken:other,lastSettledToken:token},[token,other])).toThrow("token/byte bound"));
 it("refuses an unbound historical zero row instead of declaring completion",()=>expect(()=>transferQuotaReleaseDecision(token,64,{bytes:0,pendingToken:null,lastSettledToken:null},[])).toThrow("token/byte bound"));
 it("retains a different older token unless its own current original proof closes it",()=>{expect(()=>transferQuotaReleaseDecision(token,64,{bytes:64,pendingToken:token,lastSettledToken:other},[token])).toThrow("token/byte bound");expect(transferQuotaReleaseDecision(token,64,{bytes:64,pendingToken:token,lastSettledToken:other},[token,other])).toBe("release");});
 it("refuses a smaller positive charge instead of hiding lost original bytes",()=>expect(()=>transferQuotaReleaseDecision(token,64,{bytes:63,pendingToken:token,lastSettledToken:null},[token])).toThrow("token/byte bound"));
 it("refuses fractional or unsafe accounting values",()=>{expect(()=>transferQuotaReleaseDecision(token,64.5,{bytes:65,pendingToken:token,lastSettledToken:null},[token])).toThrow();expect(()=>transferQuotaReleaseDecision(token,64,{bytes:Number.MAX_SAFE_INTEGER+1,pendingToken:token,lastSettledToken:null},[token])).toThrow();});
 it("settlement idempotency requires exact original settled token and byte count",()=>{expect(originalQuotaSettlement(token,{bytes:"64",pendingToken:null,settledToken:token},64)).toBe("already_settled");expect(()=>originalQuotaSettlement(token,{bytes:"64",pendingToken:null,settledToken:other},64)).toThrow("another original operation");expect(()=>originalQuotaSettlement(token,{bytes:"63",pendingToken:null,settledToken:token},64)).toThrow("another original operation");});
 it("missing original reservation cannot be silently settled by a zero matched update",()=>expect(()=>originalQuotaSettlement(token,undefined,64)).toThrow("Restore the exact original quota reservation"));
});
