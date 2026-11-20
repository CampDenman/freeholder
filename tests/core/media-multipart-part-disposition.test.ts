// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// PREPARED / UNRUN. Actual process-local ownership only, no remote proof.
import {describe,expect,it} from "vitest";
import {withOriginalPartDisposition,requireOriginalPartWithheldAuthority,markOriginalPartReturned} from "@/core/media/multipart-part-disposition";
const caller={id:"original-issuer",token:"actual-process-private-original-caller-token"};
describe("actual original local part response disposition",()=>{
 it("refuses an assertion without its owning actual local invocation",()=>{expect(()=>requireOriginalPartWithheldAuthority(caller.id,caller.token)).toThrow();});
 it("keeps exact call/token identity rather than accepting equal current keys or another caller",async()=>{await withOriginalPartDisposition(caller,async()=>{requireOriginalPartWithheldAuthority(caller.id,caller.token);expect(()=>requireOriginalPartWithheldAuthority("other",caller.token)).toThrow();expect(()=>requireOriginalPartWithheldAuthority(caller.id,"other-token")).toThrow();});});
 it("never allows a returned URL to acquire a withheld disposition",async()=>{await withOriginalPartDisposition(caller,async()=>{markOriginalPartReturned(caller.id,caller.token);expect(()=>requireOriginalPartWithheldAuthority(caller.id,caller.token)).toThrow();expect(()=>markOriginalPartReturned(caller.id,caller.token)).toThrow();});});
 it("expires owning authority after success and failure without a resumable receipt or timeout",async()=>{await withOriginalPartDisposition(caller,async()=>{});expect(()=>requireOriginalPartWithheldAuthority(caller.id,caller.token)).toThrow();await expect(withOriginalPartDisposition(caller,async()=>{throw Error("Actual local failure");})).rejects.toThrow();expect(()=>requireOriginalPartWithheldAuthority(caller.id,caller.token)).toThrow();});
 it("isolates actual concurrent sibling issuers and prevents a nested caller from borrowing ownership",async()=>{await Promise.all([caller,{id:"sibling",token:"different-private-token"}].map(async own=>withOriginalPartDisposition(own,async()=>{await Promise.resolve();requireOriginalPartWithheldAuthority(own.id,own.token);await expect(withOriginalPartDisposition({id:"forged",token:"forged"},async()=>{})).rejects.toThrow();requireOriginalPartWithheldAuthority(own.id,own.token); })));});
 it("deactivates inherited asynchronous work after the actual owning invocation closes",async()=>{let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;}),late:Promise<void>[]=[];await withOriginalPartDisposition(caller,async()=>{late.push((async()=>{await gate;expect(()=>requireOriginalPartWithheldAuthority(caller.id,caller.token)).toThrow();})());});release();await Promise.all(late);});
});
