// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import type {AccountedTransferStore,TransferRequestObserver,VersionedTransferStore} from "./media-transfer.mjs";
export function createS3TransferProtocol(input:{client:{fetch:typeof fetch};url:(key:string)=>string;binding:VersionedTransferStore["binding"];observer?:TransferRequestObserver}):AccountedTransferStore;
export function createReplitTransferProtocol(input:{destination:()=>Promise<unknown>;binding:VersionedTransferStore["binding"];requireOriginalEndpoint:()=>void;observer?:TransferRequestObserver}):AccountedTransferStore;
export function readS3ObjectBody(response:Response,expectedBytes?:number):Promise<Uint8Array<ArrayBuffer>>;
export function readReplitObjectBody(file:unknown,expectedBytes:number):Promise<Uint8Array<ArrayBuffer>>;
export function requireS3ConditionalAuthority(binding:VersionedTransferStore["binding"],url:(key:string)=>string,key:string,versionId?:string):void;
export function proveS3ConditionalSemantics(input:{client:{fetch:typeof fetch};url:(key:string)=>string;probeKey?:string}):Promise<{conditional:"proven"}>;
