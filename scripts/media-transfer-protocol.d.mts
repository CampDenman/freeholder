// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import type {AccountedTransferStore,TransferRequestObserver,VersionedTransferStore} from "./media-transfer.mjs";
export function createS3TransferProtocol(input:{client:{fetch:typeof fetch};url:(key:string)=>string;binding:VersionedTransferStore["binding"];observer?:TransferRequestObserver}):AccountedTransferStore;
export function createReplitTransferProtocol(input:{destination:()=>Promise<unknown>;binding:VersionedTransferStore["binding"];requireOriginalEndpoint:()=>void;observer?:TransferRequestObserver}):AccountedTransferStore;
