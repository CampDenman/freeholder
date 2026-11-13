// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Complete first membership is a point-in-time observation, never a writer
// birth backfill or permission to adopt later current generations.
import {z} from "zod";
import type {OriginalMediaErasureMembership} from "./erasure-schema";
import {objectKeyDigest} from "./write-ledger";
import {transferConflict,transferDigest} from "./transfer-proof";
const digest=z.string().regex(/^[a-f0-9]{64}$/),parent=z.object({id:z.uuid(),reservationId:z.uuid().nullable(),witness:digest}).strict();
const membership=z.object({format:z.literal("freeholder.original-media-erasure/v1"),legacyScopes:z.array(z.object({requestId:z.uuid(),scope:z.enum(["media.storageOperations","media.multipartOperations"]),artifactDigest:digest.nullable()}).strict()).max(10000),receipts:z.array(parent).max(10000),resources:z.array(parent).max(10000),uploads:z.array(z.object({id:z.uuid(),witness:digest}).strict()).max(10000),reservations:z.array(z.object({id:z.uuid(),keyDigest:digest,witness:digest}).strict()).max(10000),legacyReservations:z.array(z.object({keyDigest:digest,witness:digest}).strict()).max(10000)}).strict();
export function firstOriginalMediaMembership(input:{receipts:readonly {id:string;originalReservationId:string|null}[];resources:readonly {id:string;originalReservationId:string|null}[];uploads:readonly {id:string}[];reservations:readonly {key:string;reservationId:string|null}[];legacyScopes?:OriginalMediaErasureMembership["legacyScopes"]}):OriginalMediaErasureMembership{
 const byId=<T extends {id:string}>(rows:T[])=>rows.sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
 const result:OriginalMediaErasureMembership={format:"freeholder.original-media-erasure/v1",legacyScopes:[...input.legacyScopes??[]].sort((a,b)=>`${a.requestId}:${a.scope}`<`${b.requestId}:${b.scope}`?-1:`${a.requestId}:${a.scope}`>`${b.requestId}:${b.scope}`?1:0),receipts:byId(input.receipts.map(row=>({id:row.id,reservationId:row.originalReservationId,witness:transferDigest(row)}))),resources:byId(input.resources.map(row=>({id:row.id,reservationId:row.originalReservationId,witness:transferDigest(row)}))),uploads:byId(input.uploads.map(row=>({id:row.id,witness:transferDigest(row)}))),reservations:byId(input.reservations.flatMap(row=>row.reservationId?[{id:row.reservationId,keyDigest:objectKeyDigest(row.key),witness:transferDigest(row)}]:[])),legacyReservations:input.reservations.filter(row=>!row.reservationId).map(row=>({keyDigest:objectKeyDigest(row.key),witness:transferDigest(row)})).sort((a,b)=>a.keyDigest<b.keyDigest?-1:a.keyDigest>b.keyDigest?1:0)};
 return intactOriginalMediaMembership(result,transferDigest(result));
}
export function intactOriginalMediaMembership(value:unknown,captureDigest:string):OriginalMediaErasureMembership{
 const result=membership.safeParse(value);if(!result.success||transferDigest(result.data)!==captureDigest)transferConflict("Restore the intact complete first original media capture. Current rows cannot replace its missing or corrupt members.");
 for(const rows of [result.data.receipts,result.data.resources,result.data.uploads,result.data.reservations]){const ids=rows.map(row=>row.id);if(new Set(ids).size!==ids.length||ids.some((id,index)=>index>0&&ids[index-1]!>=id))transferConflict("The immutable original media member identities are repeated or out of order.");}
 const scopeIds=result.data.legacyScopes.map(row=>`${row.requestId}:${row.scope}`);if(new Set(scopeIds).size!==scopeIds.length||scopeIds.some((id,index)=>index>0&&scopeIds[index-1]!>=id))transferConflict("The prior original scope receipts are repeated or out of order.");
 const legacy=result.data.legacyReservations.map(row=>row.keyDigest);if(new Set(legacy).size!==legacy.length||legacy.some((id,index)=>index>0&&legacy[index-1]!>=id))transferConflict("The first legacy reservation observations are conflicting; no birth may be invented.");
 return result.data;
}
export function originalMediaBirthDebt(value:OriginalMediaErasureMembership):boolean{return Boolean(value.legacyScopes.length||value.legacyReservations.length||value.receipts.some(row=>!row.reservationId)||value.resources.some(row=>!row.reservationId));}
export function originalMediaReservationCaptured(value:OriginalMediaErasureMembership,reservationId:string):boolean{return value.reservations.some(row=>row.id===reservationId)||value.receipts.some(row=>row.reservationId===reservationId)||value.resources.some(row=>row.reservationId===reservationId);}
