// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Local closure is not a remote ABORT ACK. Monotonic byte removal also needs
// every creator independently closed, permanent key fencing and full absence.
import type {OriginalQuiescentCaller,OriginalQuiescentRequest,OriginalExecutorStop} from "./original-caller-quiescence";
import {requireOriginalExecutorStop} from "./original-caller-quiescence";
import {transferConflict,transferDigest} from "./transfer-proof";
export function requireLocallyClosedOriginalMultipartAbort(input:{caller:OriginalQuiescentCaller;requests:readonly OriginalQuiescentRequest[];namespace:string;key:string;uploadId:string;writerFinishedAt:Date|null;stop:OriginalExecutorStop|null}){
 const{caller,requests}=input,request=requests[0];
 if(!request||requests.length!==1||request.callId!==caller.id||caller.namespace!==input.namespace||transferDigest(request.runtimeIdentity)!==transferDigest(caller.runtimeIdentity)||request.descriptorDigest!==transferDigest(request.descriptor)||request.descriptor.kind!=="multipart.abort"||request.descriptor.binding.namespace!==input.namespace||request.descriptor.key!==input.key||request.descriptor.uploadId!==input.uploadId||!Number.isFinite(request.createdAt.getTime()))transferConflict("Recover only the exact original single session ABORT caller, physical nonce and UploadId. Another request or equal key cannot replace it.");
 if(caller.returnedAt&&input.writerFinishedAt&&caller.returnedAt.getTime()===input.writerFinishedAt.getTime()&&request.returnedAt&&request.returnedAt<=caller.returnedAt)return{request,mode:"actual_finish"as const,stop:null};
 requireOriginalExecutorStop(caller,requests,input.stop);if(request.createdAt>input.stop.createdAt)transferConflict("A later ABORT cannot borrow an earlier stopped original executor.");return{request,mode:"independent_stop"as const,stop:input.stop};
}
