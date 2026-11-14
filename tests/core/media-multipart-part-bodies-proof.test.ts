// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// PREPARED / UNRUN. Client declarations limit authority; they do not prove I/O.
import {describe,expect,it} from "vitest";
import {exactMultipartPartBodies,ORIGINAL_MULTIPART_PART_BYTES as SIZE,sameMultipartPartBodies,type OriginalMultipartPartBodies} from "@/core/media/multipart-part-bodies-proof";
const first={partNumber:1,bytes:SIZE,sha256:"a".repeat(64)},last={partNumber:2,bytes:3,sha256:"b".repeat(64)};
describe("whole original multipart body declaration",()=>{
 it("binds every fixed boundary and the final exact remainder, canonically ordered without changing the submitted declaration",()=>{const input=[last,first];expect(exactMultipartPartBodies(input,SIZE+3)).toEqual([first,last]);expect(input).toEqual([last,first]);});
 it("accepts a small single-part file without promoting its declared checksum to a provider receipt or finish",()=>{const result=exactMultipartPartBodies([{...first,bytes:6}],6);expect(result).toEqual([{...first,bytes:6}]);expect(result[0]).not.toHaveProperty("acceptedAt");expect(result[0]).not.toHaveProperty("writerFinishedAt");});
 it("refuses omitted, duplicate and out-of-range original part numbers",()=>{for(const parts of [[first],[first,{...last,partNumber:1}],[first,{...last,partNumber:3}]])expect(()=>exactMultipartPartBodies(parts,SIZE+3)).toThrow();});
 it("refuses a changed part boundary even when the total declared bytes are unchanged",()=>{expect(()=>exactMultipartPartBodies([{...first,bytes:SIZE-1},{...last,bytes:4}],SIZE+3)).toThrow();});
 it("refuses over/under-sized final parts and non-integer byte declarations",()=>{for(const bytes of [2,4,3.5,-1])expect(()=>exactMultipartPartBodies([first,{...last,bytes}],SIZE+3)).toThrow();});
 it("refuses noncanonical, missing or non-SHA256 body digests",()=>{for(const sha256 of ["A".repeat(64),"a".repeat(63),"etag-only",""])expect(()=>exactMultipartPartBodies([first,{...last,sha256}],SIZE+3)).toThrow();});
 it("refuses zero/unsafe whole reservations and an unbounded part set",()=>{for(const bytes of [0,-1,1.5,Number.MAX_SAFE_INTEGER+1])expect(()=>exactMultipartPartBodies([first],bytes)).toThrow();expect(()=>exactMultipartPartBodies(Array.from({length:10001},(_,i)=>({...first,partNumber:i+1})),SIZE*10001)).toThrow();});
 it("detects a same-size different file on resume without replacing the first immutable manifest",()=>{const manifest:OriginalMultipartPartBodies={format:"original-multipart-part-bodies/v1",id:"original-manifest",originalCreateCallId:"actual-create-caller",originalCreateRequestId:"actual-create-request",uploadIdDigest:"c".repeat(64),namespace:"d".repeat(64),keyDigest:"e".repeat(64),expectedBytes:SIZE+3,partBytes:SIZE,parts:[first,last]},before=JSON.stringify(manifest);expect(sameMultipartPartBodies(manifest,[last,first])).toBe(true);expect(sameMultipartPartBodies(manifest,[first,{...last,sha256:"f".repeat(64)}])).toBe(false);expect(JSON.stringify(manifest)).toBe(before);});
});
