// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.12/C11.08: pure original-admission correlation, no auth/account claim.
import { describe, expect, it } from "vitest";
import { requireOriginalProviderRequestResult, type ActualOriginalProviderObject } from "@/core/media/provider-request-proof";
import { transferDigest } from "@/core/media/transfer-proof";
import type { TransferRequestDescriptor } from "../../scripts/media-transfer.mjs";
const id="00000000-0000-4000-8000-000000000001",key="private/original.bin",namespace="a".repeat(64),tokenDigest="b".repeat(64),sha256="c".repeat(64);
const descriptor:TransferRequestDescriptor={kind:"object.put",binding:{kind:"s3",namespace,location:{bucket:"original-private"}},key,createOnly:true,sha256,bytes:6};
const admission={id,tokenDigest,descriptor,descriptorDigest:transferDigest(descriptor)};
const actual:ActualOriginalProviderObject={key,namespace,sha256,bytes:6,revision:{kind:"etag",key,namespace,value:'"original-etag"',versionId:"actual-original-version"},requestProof:{id,tokenDigest}};
describe("C1.12/C11.08 original request tag and actual byte result",()=>{
 it("matches the immutable physical admission to its actual provider generation without replacing the admission",()=>{const before=JSON.stringify(admission);expect(requireOriginalProviderRequestResult(admission,actual)).toEqual(actual.revision);expect(JSON.stringify(admission)).toBe(before);});
 for(const[name,patch]of [["missing original tag",{requestProof:undefined}],["another request",{requestProof:{id:"00000000-0000-4000-8000-000000000002",tokenDigest}}],["unmatched server nonce",{requestProof:{id,tokenDigest:"d".repeat(64)}}],["another namespace",{namespace:"d".repeat(64)}],["another key",{key:key+".later"}],["different bytes",{sha256:"d".repeat(64)}],["truncated bytes",{bytes:5}]]as const)it(`refuses ${name} despite an equal current revision label`,()=>{expect(()=>requireOriginalProviderRequestResult(admission,{...actual,...patch})).toThrow();});
 it("refuses first-descriptor corruption instead of adopting the current object as a replacement",()=>{expect(()=>requireOriginalProviderRequestResult({...admission,descriptor:{...descriptor,bytes:5}},actual)).toThrow();expect(admission.descriptorDigest).toBe(transferDigest(descriptor));});
 it("refuses a nonconditional old write even when a later object presents a matching tag",()=>{const old={...descriptor,createOnly:false};expect(()=>requireOriginalProviderRequestResult({...admission,descriptor:old,descriptorDigest:transferDigest(old)},actual)).toThrow();});
});
