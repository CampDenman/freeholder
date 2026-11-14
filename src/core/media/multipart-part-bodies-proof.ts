// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.12/C11.08: immutable body declarations are limits, never provider proof.
import {transferConflict,transferDigest} from "./transfer-proof";
export const ORIGINAL_MULTIPART_PART_BYTES=8*1024*1024;
export interface OriginalMultipartPartBody {partNumber:number;bytes:number;sha256:string}
export interface OriginalMultipartPartBodies {
 format:"original-multipart-part-bodies/v1";id:string;originalCreateCallId:string;originalCreateRequestId:string;
 uploadIdDigest:string;namespace:string;keyDigest:string;expectedBytes:number;partBytes:number;
 parts:OriginalMultipartPartBody[];
}
export function exactMultipartPartBodies(input:readonly OriginalMultipartPartBody[],expectedBytes:number):OriginalMultipartPartBody[]{
 if(!Number.isSafeInteger(expectedBytes)||expectedBytes<=0||input.length<1||input.length>10000||input.length!==Math.ceil(expectedBytes/ORIGINAL_MULTIPART_PART_BYTES))transferConflict("Select the complete original file before resuming this upload.");
 const parts=[...input].sort((a,b)=>a.partNumber-b.partNumber).map(({partNumber,bytes,sha256})=>({partNumber,bytes,sha256}));
 if(parts.some((part,index)=>part.partNumber!==index+1||!Number.isSafeInteger(part.bytes)||part.bytes!==Math.min(ORIGINAL_MULTIPART_PART_BYTES,expectedBytes-index*ORIGINAL_MULTIPART_PART_BYTES)||!(/^[a-f0-9]{64}$/.test(part.sha256))))transferConflict("The selected file's upload parts do not match its original size and checksums.");
 return parts;
}
export function sameMultipartPartBodies(original:OriginalMultipartPartBodies,parts:readonly OriginalMultipartPartBody[]):boolean{return transferDigest(original.parts)===transferDigest(exactMultipartPartBodies(parts,original.expectedBytes));}
