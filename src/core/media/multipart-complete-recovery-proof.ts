// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// An applied original session object is not an invented original ACK/FIN or
// delegated-link terminal proof. Only actual full reads and inventories apply.
import {createHash} from "node:crypto";
import type {TransferInventoryConfiguration,TransferInventoryEntry,TransferRequestObservation,TransferRevision} from "../../../scripts/media-transfer.mjs";
import type {OriginalQuiescentCaller,OriginalQuiescentRequest,OriginalExecutorStop} from "./original-caller-quiescence";
import {requireOriginalExecutorStop} from "./original-caller-quiescence";
import {requireOriginalMultipartCompletedBody,type OriginalMultipartCreateProof,type ActualMultipartCompletedBody} from "./multipart-completed-proof";
import {classifySourceInventory,providerInventoryDigest} from "./transfer-inventory-proof";
import {transferConflict,transferDigest} from "./transfer-proof";
import type {MultipartPart} from "@/adapters/storage/types";
const partsDigest=(parts:readonly MultipartPart[])=>createHash("sha256").update(JSON.stringify(parts)).digest("hex");
export function requireQuiescentOriginalMultipartComplete(input:{caller:OriginalQuiescentCaller;requests:readonly OriginalQuiescentRequest[];namespace:string;key:string;uploadId:string;parts:readonly MultipartPart[];partsDigest:string;writerFinishedAt:Date|null;facts:readonly{requestId:string;facts:TransferRequestObservation}[];stop:OriginalExecutorStop|null}){
 const{caller,requests}=input;
 if(!requests.length||caller.namespace!==input.namespace||partsDigest(input.parts)!==input.partsDigest||requests.some(row=>row.callId!==caller.id||transferDigest(row.runtimeIdentity)!==transferDigest(caller.runtimeIdentity)||row.descriptorDigest!==transferDigest(row.descriptor)||row.descriptor.binding.namespace!==input.namespace||row.descriptor.key!==input.key||!["multipart.inspect","multipart.complete","object.metadata","object.read"].includes(row.descriptor.kind)))transferConflict("Restore the exact original COMPLETE caller, physical requests and immutable part manifest.");
 const completions=requests.filter(row=>row.descriptor.kind==="multipart.complete"),complete=completions[0];
 if(completions.length!==1||!complete?.descriptor.createOnly||complete.descriptor.uploadId!==input.uploadId||complete.descriptor.partsDigest!==input.partsDigest)transferConflict("Original completion recovery requires exactly one admitted conditional COMPLETE, never a new POST or another session.");
 const proof=input.facts.filter(row=>row.facts.stage==="parts_verified"&&row.facts.detailDigest===input.partsDigest&&row.facts.uploadId===input.uploadId&&row.facts.count===input.parts.length),verified=proof[0],pages=verified?.facts.partPageIds;
 if(proof.length!==1||!verified||!pages||!pages.length||pages.length>11||new Set(pages).size!==pages.length||pages.at(-1)!==verified.requestId||requests.filter(row=>row.descriptor.kind==="multipart.inspect").length!==pages.length)transferConflict("The actual complete original part verification must precede the original COMPLETE admission.");
 for(const[id,index]of pages.map((id,index)=>[id,index]as const)){
  const page=requests.find(row=>row.id===id);
  if(!page||page.descriptor.kind!=="multipart.inspect"||page.descriptor.partsDigest!==input.partsDigest||page.descriptor.uploadId!==input.uploadId||!page.returnedAt||page.returnedAt>complete.createdAt||index===0&&page.descriptor.cursor!=null||!input.facts.some(row=>row.requestId===id&&row.facts.stage==="response_body"&&row.facts.detailDigest)||!input.facts.some(row=>row.requestId===id&&row.facts.stage==="inventory"&&row.facts.uploadId===input.uploadId))transferConflict("Every original preflight page must retain its own actual full response, digest and finish before dispatch.");
 }
 if(caller.returnedAt&&input.writerFinishedAt&&caller.returnedAt.getTime()===input.writerFinishedAt.getTime()&&requests.every(row=>row.returnedAt&&row.returnedAt<=caller.returnedAt!))return{complete,mode:"actual_finish"as const,stop:null};
 requireOriginalExecutorStop(caller,requests,input.stop);
 if(complete.createdAt>input.stop.createdAt)transferConflict("A later physical COMPLETE cannot borrow an earlier stopped executor.");
 return{complete,mode:"independent_stop"as const,stop:input.stop};
}
export function requireAppliedOriginalMultipartObject(input:{creation:OriginalMultipartCreateProof;actual:ActualMultipartCompletedBody&{partsDigest?:string};parts:readonly MultipartPart[];expectedRevision?:TransferRevision;uploadId:string;namespace:string;key:string;bytes:number;first:{configuration:TransferInventoryConfiguration;entries:readonly TransferInventoryEntry[]};confirmed:{configuration:TransferInventoryConfiguration;entries:readonly TransferInventoryEntry[]}}){
 if(input.expectedRevision&&transferDigest(input.actual.revision)!==transferDigest(input.expectedRevision))transferConflict("The first actual original COMPLETE revision cannot be replaced by current bytes or a later generation.");
 if(input.actual.partsDigest!==partsDigest(input.parts)||input.actual.bytes!==input.bytes||providerInventoryDigest(input.first.configuration,input.first.entries)!==providerInventoryDigest(input.confirmed.configuration,input.confirmed.entries))transferConflict("The full original file parts and both complete provider inventories must agree before applied review.");
 const revision=requireOriginalMultipartCompletedBody(input.creation,input.actual,{namespace:input.namespace,key:input.key,uploadId:input.uploadId,revision:input.actual.revision,maxBytes:input.bytes});
 const classified=classifySourceInventory(input.first.configuration,input.first.entries.filter(row=>row.key===input.key),[{id:input.creation.id,key:input.key,bytes:input.bytes,originalRevision:revision}],input.namespace);
 if(!classified.complete)transferConflict("Original versions, sessions, retained bytes or conflicting physical provenance remain recovery debt.");
 return revision;
}
