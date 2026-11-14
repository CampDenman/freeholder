// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// PREPARED / UNRUN. Classification inputs are not provider/account acceptance.
import {describe,expect,it} from "vitest";
import {originalSessionObservationDecision} from "@/core/media/multipart-session-observation";
const namespace="a".repeat(64),uploadId="actual-first-session";
function input():Parameters<typeof originalSessionObservationDecision>[0]{return{descriptor:{kind:"multipart.create",binding:{kind:"s3",namespace,location:{bucket:"fictional-private"}},key:"original.pdf",contentType:"application/pdf",checksumAlgorithm:"SHA256",checksumType:"COMPOSITE"},fact:{stage:"accepted",status:200,uploadId},canonicalUploadId:null,observedUploadId:null};}
describe("actual original session fact classification",()=>{
 it("recognizes first genuine positive session identity without changing inputs",()=>{const value=input(),before=structuredClone(value);expect(originalSessionObservationDecision(value)).toBe("first");expect(value).toEqual(before);});
 it("recognizes the same first identity rather than replacing the first ACK or FIN",()=>{const value=input();value.canonicalUploadId=uploadId;value.observedUploadId=uploadId;expect(originalSessionObservationDecision(value)).toBe("same");});
 it("classifies conflicting canonical/observed IDs as debt rather than throwing away a structurally valid actual fact",()=>{const value=input();value.canonicalUploadId="first-canonical";expect(originalSessionObservationDecision(value)).toBe("conflicting");const other=input();other.observedUploadId="first-observed";expect(originalSessionObservationDecision(other)).toBe("conflicting");});
 it("preserves a non-CREATE response naming a different requested UploadId only as conflicting evidence",()=>{const value=input();value.descriptor={...value.descriptor,kind:"multipart.abort",uploadId:"requested-original"};expect(originalSessionObservationDecision(value)).toBe("conflicting");value.descriptor.uploadId=uploadId;value.canonicalUploadId=uploadId;expect(originalSessionObservationDecision(value)).toBe("same");});
 it("refuses invalid positive identity strings without granting raw key/session adoption",()=>{for(const id of ["","bad\nvalue","x".repeat(4097)]){const value=input();value.fact.uploadId=id;expect(()=>originalSessionObservationDecision(value)).toThrow();}});
 it("refuses error/absence/read/capability events as a positive provider session ACK",()=>{for(const stage of ["absence","inventory","capability"]as const){const value=input();value.fact.stage=stage;expect(()=>originalSessionObservationDecision(value)).toThrow();}const value=input();value.fact.status=500;expect(()=>originalSessionObservationDecision(value)).toThrow();});
 it("does not treat a local signing result as provider acceptance even with a well-formed session string",()=>{const value=input();value.descriptor.kind="multipart.sign";expect(()=>originalSessionObservationDecision(value)).toThrow();});
});
