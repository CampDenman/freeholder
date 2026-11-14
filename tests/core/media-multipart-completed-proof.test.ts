// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// PREPARED / UNRUN. Proof controls do not confer part consumption authority.
import {describe,expect,it} from "vitest";
import {createHash} from "node:crypto";
import {requireOriginalMultipartCompletedBody} from "@/core/media/multipart-completed-proof";
import {transferDigest} from "@/core/media/transfer-proof";
import type {TransferRequestDescriptor} from "../../scripts/media-transfer.mjs";
const namespace="a".repeat(64),key="original/assembled.bin",id="00000000-0000-4000-8000-000000000001",tokenDigest="b".repeat(64),uploadId="original-session",body=new TextEncoder().encode("original bytes"),revision={kind:"etag"as const,key,namespace,value:'"original-completed"',versionId:"original-version"},descriptor:TransferRequestDescriptor={kind:"multipart.create",key,binding:{kind:"s3",namespace,location:{bucket:"fictional-owned"}},contentType:"application/octet-stream"};
const creation=()=>({id,tokenDigest,descriptor,descriptorDigest:transferDigest(descriptor),state:"returned",returnedAt:new Date("2026-11-13T00:00:00Z"),observedUploadId:uploadId});
const actual=()=>({key,namespace,revision,sha256:createHash("sha256").update(body).digest("hex"),bytes:body.byteLength,requestProof:{id,tokenDigest}});
const expected=()=>({uploadId,key,namespace,revision,maxBytes:body.byteLength});
describe("exact original multipart completed object ancestry",()=>{
 it("accepts the full exact pinned body with the genuine original CREATE nonce, without adding terminal or caller fields",()=>{const source=creation(),read=actual();expect(requireOriginalMultipartCompletedBody(source,read,expected())).toEqual(revision);expect(source).not.toHaveProperty("consumedAt");expect(read).not.toHaveProperty("writerFinishedAt");});
 it("refuses same key/hash/size/revision with another original physical CREATE nonce",()=>{expect(()=>requireOriginalMultipartCompletedBody(creation(),{...actual(),requestProof:{id:"00000000-0000-4000-8000-000000000002",tokenDigest}},expected())).toThrow("original upload session");});
 it("refuses missing provider nonce or a matching ID with another server-held original token",()=>{expect(()=>requireOriginalMultipartCompletedBody(creation(),{...actual(),requestProof:undefined},expected())).toThrow();expect(()=>requireOriginalMultipartCompletedBody(creation(),{...actual(),requestProof:{id,tokenDigest:"c".repeat(64)}},expected())).toThrow();});
 it("refuses another original UploadId even with identical current object bytes",()=>{expect(()=>requireOriginalMultipartCompletedBody({...creation(),observedUploadId:"another-session"},actual(),expected())).toThrow();});
 it("refuses missing or failed actual CREATE finish instead of using a current read to invent that FIN",()=>{expect(()=>requireOriginalMultipartCompletedBody({...creation(),returnedAt:null},actual(),expected())).toThrow();expect(()=>requireOriginalMultipartCompletedBody({...creation(),state:"unknown"},actual(),expected())).toThrow();});
 it("refuses rewritten original physical descriptors and different namespace/key/revision",()=>{expect(()=>requireOriginalMultipartCompletedBody({...creation(),descriptorDigest:"d".repeat(64)},actual(),expected())).toThrow();for(const read of [{...actual(),namespace:"e".repeat(64)},{...actual(),key:"later/same.bin"},{...actual(),revision:{...revision,versionId:"later-version"}}])expect(()=>requireOriginalMultipartCompletedBody(creation(),read,expected())).toThrow();});
 it("refuses unsafe/oversized or non-full-digest body evidence and does not mutate the original receipt",()=>{const source=creation(),before=JSON.stringify(source);for(const read of [{...actual(),bytes:body.byteLength+1},{...actual(),bytes:-1},{...actual(),sha256:"HEAD-etag-only"}])expect(()=>requireOriginalMultipartCompletedBody(source,read,expected())).toThrow();expect(JSON.stringify(source)).toBe(before);});
});
