// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import {describe,expect,it} from "vitest";
import {originalQuotaSettlement} from "@/core/media/original-recovery-quota";
const original="00000000-0000-4000-8000-000000000001",later="00000000-0000-4000-8000-000000000002";
describe("C10.32/C11.08 original quota settlement authority",()=>{
 it("settles only the exact original reserved token within its byte bound",()=>expect(originalQuotaSettlement(original,{bytes:"6",pendingToken:original,settledToken:null},6)).toBe("pending"));
 it("recognizes the exact retained actual settlement token without borrowing a current equal key",()=>expect(originalQuotaSettlement(original,{bytes:"6",pendingToken:null,settledToken:original},6)).toBe("already_settled"));
 it("refuses another pending token even when current bytes are identical",()=>expect(()=>originalQuotaSettlement(original,{bytes:"6",pendingToken:later,settledToken:original},6)).toThrow("Another quota token"));
 it("refuses old/unattributed or another operation's settled row despite equal bytes",()=>{for(const token of [null,later])expect(()=>originalQuotaSettlement(original,{bytes:"6",pendingToken:null,settledToken:token},6)).toThrow("another original operation");});
 it("refuses missing reservation or a smaller byte bound instead of inventing additional capacity",()=>{expect(()=>originalQuotaSettlement(original,undefined,6)).toThrow("Restore the exact original");expect(()=>originalQuotaSettlement(original,{bytes:"5",pendingToken:original,settledToken:null},6)).toThrow("changed reserved bytes");});
 it("refuses a changed settled byte count for the same original token",()=>expect(()=>originalQuotaSettlement(original,{bytes:"7",pendingToken:null,settledToken:original},6)).toThrow("another original operation"));
});
