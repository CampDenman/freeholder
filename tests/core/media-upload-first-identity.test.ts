// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// SOURCE PREPARED / UNRUN. Actual pure capture serialization contracts.
import {describe,expect,it} from "vitest";
import {firstOriginalMediaMembership,intactOriginalMediaMembership,originalMediaReservationCaptured} from "@/core/media/original-erasure-proof";
import {objectKeyDigest} from "@/core/media/write-ledger";
import {transferDigest} from "@/core/media/transfer-proof";
const id="00000000-0000-4000-8000-000000000021",reservation="00000000-0000-4000-8000-000000000022",other="00000000-0000-4000-8000-000000000023",key="private/fictional-original.pdf";
const capture=(uploads:Parameters<typeof firstOriginalMediaMembership>[0]["uploads"],priorUploadIdentities?:Parameters<typeof firstOriginalMediaMembership>[0]["priorUploadIdentities"])=>firstOriginalMediaMembership({receipts:[],resources:[],reservations:[],uploads,priorUploadIdentities});
describe("immutable upload first identity without historical JSON rewrites",()=>{
 it("preserves the exact old absent-field body and witness",()=>{const row={id},value=capture([row]);expect(value.uploads).toEqual([{id,witness:transferDigest(row)}]);expect(intactOriginalMediaMembership(value,transferDigest(value))).toEqual(value);expect(Object.hasOwn(value.uploads[0]!,"reservationId")).toBe(false);});
 it("keeps an actual historical NULL rather than filling from another reservation",()=>{const value=capture([{id,originalReservationId:null,storageKey:key}]);expect(value.uploads[0]).toMatchObject({reservationId:null,keyDigest:objectKeyDigest(key)});expect(originalMediaReservationCaptured(value,reservation)).toBe(false);});
 it("retains the actual new UUID and first raw-key digest without exporting the raw key",()=>{const row={id,originalReservationId:reservation,storageKey:key},value=capture([row]);expect(value.uploads[0]).toEqual({id,reservationId:reservation,keyDigest:objectKeyDigest(key),witness:transferDigest(row)});expect(JSON.stringify(value)).not.toContain(key);expect(originalMediaReservationCaptured(value,reservation)).toBe(true);expect(originalMediaReservationCaptured(value,other)).toBe(false);});
 it("does not exclude a new NULL cell from the actual whole-row witness",()=>{const old={id,storageKey:key},next={...old,originalReservationId:null};expect(capture([next]).uploads[0]?.witness).toBe(transferDigest(next));expect(capture([next]).uploads[0]?.witness).not.toBe(capture([old]).uploads[0]?.witness);});
 it("never rehashes an unauthenticated retained marker into a first key digest",()=>{const value=capture([{id,originalReservationId:reservation,storageKey:`retained:${objectKeyDigest(key)}`}]);expect(Object.hasOwn(value.uploads[0]!,"keyDigest")).toBe(false);});
 it("reuses only the agreeing exact previously authenticated first tuple",()=>{const digest=objectKeyDigest(key),value=capture([{id,originalReservationId:reservation,storageKey:`retained:${digest}`}],[{id,reservationId:reservation,keyDigest:digest}]);expect(value.uploads[0]?.keyDigest).toBe(digest);expect(value.uploads[0]?.keyDigest).not.toBe(objectKeyDigest(`retained:${digest}`));});
 it("refuses another reservation even when its private key is equal",()=>expect(()=>capture([{id,originalReservationId:reservation,storageKey:key}],[{id,reservationId:other,keyDigest:objectKeyDigest(key)}])).toThrow("conflicts"));
 it("refuses disagreeing earlier identities instead of selecting the latest",()=>expect(()=>capture([{id,originalReservationId:reservation,storageKey:key}],[{id,reservationId:reservation,keyDigest:objectKeyDigest(key)},{id,reservationId:reservation,keyDigest:"f".repeat(64)}])).toThrow("conflicts"));
});
