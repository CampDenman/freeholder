// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import type {TransferRequestObserver,TransferRevision} from './media-transfer.mjs';
type Part={partNumber:number;etag:string;bytes?:number};
type Accepted=(result:{uploadId:string;revision?:TransferRevision})=>Promise<void>;
export function createS3MultipartProtocol(options:{client:{fetch(input:RequestInfo|URL|{toString():string},init?:RequestInit):Promise<Response>};binding:{kind:'s3';namespace:string;location:Readonly<Record<string,string>>};url:(key:string)=>string;observer:TransferRequestObserver}):{
 create(key:string,contentType:string,onAccepted?:Accepted):Promise<{uploadId:string}>;
 inspect(key:string,uploadId:string):Promise<{state:'open';parts:Part[]}|{state:'absent'}>;
 complete(key:string,uploadId:string,parts:Part[],onAccepted?:Accepted):Promise<{key:string;bytes:number;contentType:string;etag:string}>;
 abort(key:string,uploadId:string,onAccepted?:Accepted):Promise<void>;
};
