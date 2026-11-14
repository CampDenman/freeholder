// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import type {TransferRequestObserver,VersionedTransferStore} from './media-transfer.mjs';
export interface OriginalPartCapabilityProof {format:'original-multipart-part-capability/v1';requestId:string;urlDigest:string;headersDigest:string;expiresAt:string;uploadIdDigest:string;partNumber:number;sha256:string;bytes:number}
export interface OriginalPartCapabilityResult {url:string;method:'PUT';headers:Record<string,string>;expiresAt:string;capabilityDigest:string;proof:OriginalPartCapabilityProof}
export interface OriginalPartSignatureInput {key:string;uploadId:string;partNumber:number;sha256:string;bytes:number;expiresAt:string}
export function createS3MultipartPartIssuer(input:{binding:VersionedTransferStore['binding'];url:(key:string)=>string;client:{sign(input:Request|{toString():string},init?:RequestInit&{aws?:{signQuery?:boolean;allHeaders?:boolean;datetime?:string}}):Promise<Request>};observer:TransferRequestObserver}):(input:OriginalPartSignatureInput)=>Promise<OriginalPartCapabilityResult>;
