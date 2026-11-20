// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Pure continuation controls only; no physical/provider execution is claimed.
import {describe,expect,it} from "vitest";
import {originalDeleteContinuation,type EarlierOriginalDelete} from "@/core/media/original-delete-continuation";
import {transferDigest} from "@/core/media/transfer-proof";
const returnedAt=new Date("2026-11-13T00:00:00Z"),id="00000000-0000-4000-8000-000000000001",requestId="00000000-0000-4000-8000-000000000002",namespace="a".repeat(64),key="private/original.bin",descriptor={kind:"object.delete"as const,binding:{kind:"s3"as const,namespace,location:{bucket:"fictional-private"}},key,expectedRevision:{kind:"etag"as const,namespace,key,value:'"original"'}};
function unattempted():EarlierOriginalDelete{return{id,state:"returned",returnedAt,resultDigest:transferDigest({notAttempted:true}),observedAcceptedAt:null,requests:[],facts:[]};}
function physical():EarlierOriginalDelete{const result=unattempted();result.requests=[{id:requestId,callId:id,state:"returned",returnedAt,descriptor:structuredClone(descriptor),descriptorDigest:transferDigest(descriptor)}];return result;}
function accepted():EarlierOriginalDelete{const result=physical();result.resultDigest=transferDigest({accepted:true});result.observedAcceptedAt=returnedAt;result.facts=[{requestId,stage:"response"},{requestId,stage:"accepted"}];return result;}
describe("genuine unattempted original DELETE continuation",()=>{
 it("permits a first new caller when no earlier retirement intent exists",()=>expect(originalDeleteContinuation([])).toBe("new_caller"));
 it("permits a separately born caller after an authentic unattempted closure with no physical admission",()=>{const input=[unattempted()],before=structuredClone(input);expect(originalDeleteContinuation(input)).toBe("new_caller");expect(input).toEqual(before);});
 it("permits an actually admitted request stopped before provider I/O only with its authentic not_attempted fact and finish",()=>{const call=physical();call.facts=[{requestId,stage:"not_attempted"}];expect(originalDeleteContinuation([call])).toBe("new_caller");});
 it("permits fresh verification only after an actual acknowledged conditional DELETE",()=>{const input=[unattempted(),accepted()],before=structuredClone(input);expect(originalDeleteContinuation(input)).toBe("verification_only");expect(input).toEqual(before);});
 it("refuses a paused or unknown earlier caller despite its unattempted assertion",()=>{for(const change of [{state:"admitted"},{state:"unknown"},{returnedAt:null}]){const call=unattempted();Object.assign(call,change);expect(()=>originalDeleteContinuation([call])).toThrow("no exact actual finish");}});
 it("refuses an unattempted closure with a physical admission lacking its own finish",()=>{const call=physical();call.requests[0]!.returnedAt=null;call.facts=[{requestId,stage:"not_attempted"}];expect(()=>originalDeleteContinuation([call])).toThrow("actual finish");});
 it("refuses a response or accepted fact hidden behind notAttempted",()=>{for(const stage of ["response","accepted","metadata","body"]){const call=physical();call.facts=[{requestId,stage:"not_attempted"},{requestId,stage}];expect(()=>originalDeleteContinuation([call])).toThrow("not genuinely unattempted");}});
 it("refuses a physical request without an actual not_attempted fact",()=>expect(()=>originalDeleteContinuation([physical()])).toThrow("not genuinely unattempted"));
 it("refuses a positive logical ACK hidden behind an unattempted closure",()=>{const call=unattempted();call.observedAcceptedAt=returnedAt;expect(()=>originalDeleteContinuation([call])).toThrow("not genuinely unattempted");});
 it("refuses an ambiguous provider error as authority for a new dispatch",()=>{const call=physical();call.resultDigest=transferDigest({failed:true});expect(()=>originalDeleteContinuation([call])).toThrow("ambiguous original DELETE");});
 it("refuses an accepted assertion without an actual physical acceptance fact",()=>{const call=accepted();call.facts=[{requestId,stage:"response"}];expect(()=>originalDeleteContinuation([call])).toThrow("ambiguous original DELETE");});
 it("refuses a changed descriptor or another caller's physical admission",()=>{for(const changed of ["descriptor","caller"]){const call=accepted();if(changed==="descriptor")call.requests[0]!.descriptor.key="other-generation.bin";else call.requests[0]!.callId="00000000-0000-4000-8000-000000000003";expect(()=>originalDeleteContinuation([call])).toThrow("actual finish");}});
 it("refuses multiple actual dispatches rather than select one convenient accepted result",()=>{const first=accepted(),second=accepted();second.id="00000000-0000-4000-8000-000000000003";second.requests[0]!.callId=second.id;expect(()=>originalDeleteContinuation([first,second])).toThrow("Multiple actual");});
});
