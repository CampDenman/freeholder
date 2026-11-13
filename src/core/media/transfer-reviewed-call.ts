// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.12/C11.08: an operator review is distinct from an actual provider ACK.
import {transferDigest} from "./transfer-proof";
export interface ReviewedCall {id:string;state:string;stopReceiptId:string|null;returnedAt:Date|null;observedAcceptedAt:Date|null;resultDigest?:string|null}
export interface CallReview {id:string;callId:string;outcome:string;permitsRetry:boolean}
export function transferCallApplied(call:ReviewedCall|undefined,reviews:readonly CallReview[]):boolean{
 if(!call)return false;
 if(call.state==="returned"&&call.returnedAt&&call.observedAcceptedAt)return true;
 return call.state==="stopped"&&reviews.some(review=>review.id===call.stopReceiptId&&review.callId===call.id&&review.outcome==="applied");
}
export function transferCallRetryPermitted(call:ReviewedCall|undefined,reviews:readonly CallReview[]):boolean{
 if(call?.state==="returned"&&call.returnedAt&&!call.observedAcceptedAt&&call.resultDigest===transferDigest({notAttempted:true}))return true;
 return Boolean(call?.state==="stopped"&&reviews.some(review=>review.id===call.stopReceiptId&&review.callId===call.id&&review.outcome==="not_applied"&&review.permitsRetry));
}
