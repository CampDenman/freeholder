// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Complete first membership is a point-in-time observation, never a writer
// birth backfill or permission to adopt later current generations.
import {z} from "zod";
import type {OriginalMediaErasureMembership,OriginalUploadLegacyAnchor} from "./erasure-schema";
import {objectKeyDigest} from "./write-ledger";
import {transferConflict,transferDigest} from "./transfer-proof";
const digest=z.string().regex(/^[a-f0-9]{64}$/),parent=z.object({id:z.uuid(),reservationId:z.uuid().nullable(),witness:digest}).strict();
export const originalUploadLegacyAnchorSchema=z.object({requestId:z.uuid(),captureDigest:digest,reservationId:z.uuid(),keyDigest:digest,pointerWitness:digest,uploadWitness:digest}).strict();
const membership=z.object({format:z.literal("freeholder.original-media-erasure/v1"),legacyScopes:z.array(z.object({requestId:z.uuid(),scope:z.enum(["media.storageOperations","media.multipartOperations"]),artifactDigest:digest.nullable()}).strict()).max(10000),receipts:z.array(parent).max(10000),resources:z.array(parent).max(10000),uploads:z.array(z.object({id:z.uuid(),reservationId:z.uuid().nullable().optional(),keyDigest:digest.optional(),legacyAnchor:originalUploadLegacyAnchorSchema.optional(),witness:digest}).strict()).max(10000),reservations:z.array(z.object({id:z.uuid(),keyDigest:digest,witness:digest}).strict()).max(10000),legacyReservations:z.array(z.object({keyDigest:digest,witness:digest}).strict()).max(10000)}).strict();
/** Old JSON lacks these optional cells and must stay byte-exact. A retained
 * locator never supplies a new first digest; only authenticated prior capture
 * identities assembled by the shared subject/history reader may do that. */
function firstUploadMember(row:{id:string;originalReservationId?:string|null;storageKey?:string},prior:readonly {id:string;reservationId:string;keyDigest:string}[],legacyAnchor?:OriginalUploadLegacyAnchor):OriginalMediaErasureMembership["uploads"][number]{
 const previous=prior.filter(member=>member.id===row.id),raw=typeof row.storageKey==="string"&&!row.storageKey.startsWith("retained:")?objectKeyDigest(row.storageKey):undefined;
 if(previous.some(member=>member.reservationId!==row.originalReservationId||raw!==undefined&&raw!==member.keyDigest)||new Set(previous.map(member=>`${member.reservationId}:${member.keyDigest}`)).size>1)transferConflict("The original upload birth/digest evidence conflicts. Keep every first capture for review.");
 if(legacyAnchor&&(row.originalReservationId!==null||raw!==undefined&&raw!==legacyAnchor.keyDigest||raw===undefined&&row.storageKey!==`retained:${legacyAnchor.keyDigest}`))transferConflict("The captured legacy upload anchor disagrees with its actual NULL birth or first key digest.");
 const retained=previous[0],keyDigest=raw??(retained&&row.storageKey===`retained:${retained.keyDigest}`?retained.keyDigest:undefined)??legacyAnchor?.keyDigest;
 return{id:row.id,...(Object.hasOwn(row,"originalReservationId")?{reservationId:row.originalReservationId}:{}),...(keyDigest?{keyDigest}:{}),...(legacyAnchor?{legacyAnchor}:{}),witness:transferDigest(row)};
}
export function firstOriginalMediaMembership(input:{receipts:readonly {id:string;originalReservationId:string|null}[];resources:readonly {id:string;originalReservationId:string|null}[];uploads:readonly {id:string;originalReservationId?:string|null;storageKey?:string}[];priorUploadIdentities?:readonly {id:string;reservationId:string;keyDigest:string}[];legacyUploadAnchors?:readonly {id:string;anchor:OriginalUploadLegacyAnchor}[];reservations:readonly {key:string;reservationId:string|null}[];legacyScopes?:OriginalMediaErasureMembership["legacyScopes"]}):OriginalMediaErasureMembership{
 const anchors=input.legacyUploadAnchors??[];if(new Set(anchors.map(row=>row.id)).size!==anchors.length||anchors.some(row=>!input.uploads.some(upload=>upload.id===row.id)))transferConflict("The complete legacy upload anchor membership is ambiguous or belongs to another upload.");
 const byId=<T extends {id:string}>(rows:T[])=>rows.sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
 const result:OriginalMediaErasureMembership={format:"freeholder.original-media-erasure/v1",legacyScopes:[...input.legacyScopes??[]].sort((a,b)=>`${a.requestId}:${a.scope}`<`${b.requestId}:${b.scope}`?-1:`${a.requestId}:${a.scope}`>`${b.requestId}:${b.scope}`?1:0),receipts:byId(input.receipts.map(row=>({id:row.id,reservationId:row.originalReservationId,witness:transferDigest(row)}))),resources:byId(input.resources.map(row=>({id:row.id,reservationId:row.originalReservationId,witness:transferDigest(row)}))),uploads:byId(input.uploads.map(row=>firstUploadMember(row,input.priorUploadIdentities??[],input.legacyUploadAnchors?.find(member=>member.id===row.id)?.anchor))),reservations:byId(input.reservations.flatMap(row=>row.reservationId?[{id:row.reservationId,keyDigest:objectKeyDigest(row.key),witness:transferDigest(row)}]:[])),legacyReservations:input.reservations.filter(row=>!row.reservationId).map(row=>({keyDigest:objectKeyDigest(row.key),witness:transferDigest(row)})).sort((a,b)=>a.keyDigest<b.keyDigest?-1:a.keyDigest>b.keyDigest?1:0)};
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
export function originalMediaReservationCaptured(value:OriginalMediaErasureMembership,reservationId:string):boolean{return value.reservations.some(row=>row.id===reservationId)||value.receipts.some(row=>row.reservationId===reservationId)||value.resources.some(row=>row.reservationId===reservationId)||value.uploads.some(row=>row.reservationId===reservationId||row.legacyAnchor?.reservationId===reservationId);}

/** Empty erasure metadata is a JSON object; arrays/null/scalars retain debt. */
export function originalUploadMetadataIsEmpty(value:unknown):boolean{
 return value!==null&&typeof value==="object"&&!Array.isArray(value)&&Object.keys(value).length===0;
}
