// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// PREPARED / UNRUN. Manifest selection is not provider or consumption proof.
import {describe,expect,it} from "vitest";
import {originalMultipartCompleteManifest} from "@/core/media/multipart-complete-manifest";
import type {OriginalMultipartPartBodies} from "@/core/media/multipart-part-bodies-proof";
const original=():OriginalMultipartPartBodies=>({format:"original-multipart-part-bodies/v1",id:"declaration",originalCreateCallId:"caller",originalCreateRequestId:"physical",uploadIdDigest:"a".repeat(64),namespace:"b".repeat(64),keyDigest:"c".repeat(64),expectedBytes:8388610,partBytes:8388608,parts:[{partNumber:1,bytes:8388608,sha256:"d".repeat(64)},{partNumber:2,bytes:2,sha256:"e".repeat(64)}]});
const receipts=()=>[{partNumber:1,etag:'"actual-first"'},{partNumber:2,etag:'"actual-final"'}];
describe("original multipart COMPLETE manifest selection",()=>{
 it("keeps browser receipts and derives only fixed sizes/checksums from the original declaration",()=>{expect(originalMultipartCompleteManifest(receipts(),original())).toEqual([{partNumber:1,etag:'"actual-first"',bytes:8388608,checksumSha256:Buffer.from("d".repeat(64),"hex").toString("base64")},{partNumber:2,etag:'"actual-final"',bytes:2,checksumSha256:Buffer.from("e".repeat(64),"hex").toString("base64")}]);});
 it("does not mutate the declaration or the original browser receipts",()=>{const declaration=original(),parts=receipts(),before=JSON.stringify({declaration,parts});originalMultipartCompleteManifest(parts,declaration);expect(JSON.stringify({declaration,parts})).toBe(before);});
 it("refuses missing and extra receipts instead of selecting a provider-listed manifest",()=>{expect(()=>originalMultipartCompleteManifest(receipts().slice(0,1),original())).toThrow();expect(()=>originalMultipartCompleteManifest([...receipts(),{partNumber:3,etag:'"extra"'}],original())).toThrow();});
 it("refuses reordered, duplicated or nonoriginal part numbers",()=>{expect(()=>originalMultipartCompleteManifest(receipts().reverse(),original())).toThrow();expect(()=>originalMultipartCompleteManifest([receipts()[0]!,receipts()[0]!],original())).toThrow();});
 it("refuses a supplied receipt checksum or size that differs from the fixed original file",()=>{expect(()=>originalMultipartCompleteManifest([{...receipts()[0]!,checksumSha256:Buffer.alloc(32).toString("base64")},receipts()[1]!],original())).toThrow();expect(()=>originalMultipartCompleteManifest([{...receipts()[0]!,bytes:1},receipts()[1]!],original())).toThrow();});
 it("refuses malformed ETags without trimming, inventing or replacing them",()=>{for(const etag of ["","x\nforged","x".repeat(257)])expect(()=>originalMultipartCompleteManifest([{...receipts()[0]!,etag},receipts()[1]!],original())).toThrow();});
 it("accepts explicitly identical receipt byte/checksum claims without treating them as received-byte evidence",()=>{const declared=originalMultipartCompleteManifest(receipts(),original());expect(originalMultipartCompleteManifest(declared,original())).toEqual(declared);expect(declared[0]).not.toHaveProperty("returnedAt");expect(declared[0]).not.toHaveProperty("consumedAt");});
 it("refuses a partial or resized original declaration instead of rebasing it on the supplied receipts",()=>{expect(()=>originalMultipartCompleteManifest(receipts(),{...original(),expectedBytes:8388611})).toThrow();expect(()=>originalMultipartCompleteManifest(receipts(),{...original(),parts:original().parts.slice(0,1)})).toThrow();});
});
