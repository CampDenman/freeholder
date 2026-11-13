// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// A genuinely unattempted closure permits a separately born caller. Neither a
// timeout nor an ambiguous or acknowledged dispatch permits physical replay.
import type {TransferRequestDescriptor} from "../../../scripts/media-transfer.mjs";
import {transferConflict,transferDigest} from "./transfer-proof";
export interface EarlierOriginalDelete{
 id:string;state:string;returnedAt:Date|null;resultDigest:string|null;observedAcceptedAt:Date|null;
 requests:readonly {id:string;callId:string;state:string;returnedAt:Date|null;descriptor:TransferRequestDescriptor;descriptorDigest:string}[];
 facts:readonly {requestId:string;stage:string}[];
}
export function originalDeleteContinuation(earlier:readonly EarlierOriginalDelete[]):"new_caller"|"verification_only"{
 let dispatched=false;
 for(const call of earlier){
  if(call.state!=="returned"||!call.returnedAt||!Number.isFinite(call.returnedAt.getTime())||call.requests.length>1||call.requests.some(request=>request.callId!==call.id||request.state!=="returned"||!request.returnedAt||request.descriptor.kind!=="object.delete"||request.descriptorDigest!==transferDigest(request.descriptor)))transferConflict("An earlier original DELETE has no exact actual finish; never restart its physical request.");
  const unattempted=call.resultDigest===transferDigest({notAttempted:true});
  if(unattempted){
   if(call.observedAcceptedAt||call.requests.some(request=>!call.facts.some(fact=>fact.requestId===request.id&&fact.stage==="not_attempted")||call.facts.some(fact=>fact.requestId===request.id&&fact.stage!=="not_attempted")))transferConflict("The earlier original provider operation was not genuinely unattempted. Preserve its actual facts and recover it.");
  }else{
   if(!call.observedAcceptedAt||call.resultDigest!==transferDigest({accepted:true})||call.requests.length!==1||!call.facts.some(fact=>fact.requestId===call.requests[0]!.id&&fact.stage==="accepted"))transferConflict("An ambiguous original DELETE cannot acquire a new physical caller.");
   if(dispatched)transferConflict("Multiple actual original DELETE dispatches require exact recovery, not another retry.");
   dispatched=true;
  }
 }
 return dispatched?"verification_only":"new_caller";
}
