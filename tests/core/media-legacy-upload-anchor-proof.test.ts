// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// PREPARED / UNRUN. Safe immutable evidence shape, never remote authority.
import {describe,expect,it} from "vitest";
import {firstOriginalMediaMembership,intactOriginalMediaMembership,originalMediaReservationCaptured} from "@/core/media/original-erasure-proof";
import type {OriginalUploadLegacyAnchor} from "@/core/media/erasure-schema";
import {objectKeyDigest} from "@/core/media/write-ledger";
import {transferDigest} from "@/core/media/transfer-proof";
const uploadId="00000000-0000-4000-8000-000000000061",reservationId="00000000-0000-4000-8000-000000000062",requestId="00000000-0000-4000-8000-000000000063",key="private/fictional-old-intake.pdf";
const anchor:OriginalUploadLegacyAnchor={requestId,captureDigest:"a".repeat(64),reservationId,keyDigest:objectKeyDigest(key),pointerWitness:"b".repeat(64),uploadWitness:"c".repeat(64)};
const row={id:uploadId,originalReservationId:null,storageKey:key};
const capture=(uploads:Parameters<typeof firstOriginalMediaMembership>[0]["uploads"],legacyUploadAnchors?:Parameters<typeof firstOriginalMediaMembership>[0]["legacyUploadAnchors"])=>firstOriginalMediaMembership({receipts:[],resources:[],reservations:[],uploads,legacyUploadAnchors});
describe("legacy NULL upload historical anchor without a canonical birth fill",()=>{
 it("keeps all old optional cells absent and preserves its old exact JSON digest",()=>{const old=capture([{id:uploadId}]),digest=transferDigest(old);expect(intactOriginalMediaMembership(old,digest)).toEqual(old);expect(Object.hasOwn(old.uploads[0]!,"legacyAnchor")).toBe(false);expect(Object.hasOwn(old.uploads[0]!,"reservationId")).toBe(false);});
 it("retains the old literal upload witness while current capture hashes the entire new row",()=>{const value=capture([row],[{id:uploadId,anchor}]);expect(value.uploads[0]).toEqual({id:uploadId,reservationId:null,keyDigest:anchor.keyDigest,legacyAnchor:anchor,witness:transferDigest(row)});expect(value.uploads[0]?.legacyAnchor?.uploadWitness).toBe(anchor.uploadWitness);expect(value.uploads[0]?.witness).not.toBe(anchor.uploadWitness);});
 it("recognizes only the captured old reservation without filling NULL or exposing a locator",()=>{const value=capture([row],[{id:uploadId,anchor}]);expect(value.uploads[0]?.reservationId).toBeNull();expect(originalMediaReservationCaptured(value,reservationId)).toBe(true);expect(originalMediaReservationCaptured(value,requestId)).toBe(false);expect(JSON.stringify(value)).not.toContain(key);});
 it("retains the authenticated first digest after reduction rather than hashing a marker",()=>{const value=capture([{...row,storageKey:`retained:${anchor.keyDigest}`}],[{id:uploadId,anchor}]);expect(value.uploads[0]?.keyDigest).toBe(anchor.keyDigest);expect(value.uploads[0]?.keyDigest).not.toBe(objectKeyDigest(`retained:${anchor.keyDigest}`));});
 it("refuses an anchor on a non-NULL canonical birth",()=>expect(()=>capture([{...row,originalReservationId:reservationId}],[{id:uploadId,anchor}])).toThrow("NULL birth"));
 it("refuses a raw or retained locator disagreeing with the exact first digest",()=>{expect(()=>capture([{...row,storageKey:"other-generation.pdf"}],[{id:uploadId,anchor}])).toThrow("first key digest");expect(()=>capture([{...row,storageKey:`retained:${"f".repeat(64)}`}],[{id:uploadId,anchor}])).toThrow("first key digest");});
 it("refuses duplicate or other-upload anchors instead of silently choosing one",()=>{expect(()=>capture([row],[{id:uploadId,anchor},{id:uploadId,anchor:{...anchor,reservationId:requestId}}])).toThrow("ambiguous");expect(()=>capture([row],[{id:requestId,anchor}])).toThrow("another upload");});
 it("rejects a malformed anchor even when the caller supplies a matching body hash",()=>{const value=capture([row],[{id:uploadId,anchor}]),bad={...value,uploads:[{...value.uploads[0],legacyAnchor:{...anchor,pointerWitness:"not-a-witness"}}]};expect(()=>intactOriginalMediaMembership(bad,transferDigest(bad))).toThrow("complete first original media capture");});
});
