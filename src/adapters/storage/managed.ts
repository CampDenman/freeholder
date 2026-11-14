// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The application instance cannot dispatch a raw managed mutation. Owning
// services provide the genuine committed original caller and real observer;
// standalone low-level provider factories retain their operator/test contract.
import type {StorageAdapter} from "./types";
export function withManagedStorageMutations(store:StorageAdapter):StorageAdapter{
 const authority=async(observer:unknown,key:string,kind:"object.put"|"multipart.create"|"multipart.complete"|"multipart.abort")=>{
  if(typeof observer!=="function")throw new Error("Start storage work through its shared upload or recovery service; no original caller is active.");
  const{requireActualStorageMutation}=await import("@/core/media/transfer-requests");
  await requireActualStorageMutation(observer,key,kind);
 };
 const multipart=store.directMultipart;
 return{...store,
  async put(key,body,type,observation){await authority(observation?.request,key,"object.put");return store.put(key,body,type,observation);},
  async delete(){throw new Error("Use the shared original-file removal service so its exact physical bytes and caller can be verified.");},
  ...(multipart?{directMultipart:{...multipart,
   async create(key,type,observation){await authority(observation?.request,key,"multipart.create");return multipart.create(key,type,observation);},
   async complete(key,uploadId,parts,observation){await authority(observation?.request,key,"multipart.complete");return multipart.complete(key,uploadId,parts,observation);},
   async abort(key,uploadId,observation){await authority(observation?.request,key,"multipart.abort");return multipart.abort(key,uploadId,observation);},
   // No actual original per-part admission/revocation protocol exists yet.
   // A generic full request flag or raw adapter reference cannot mint a URL.
   async signPart(){throw new Error("Direct upload links are unavailable until upload recovery is fully supported. Keep the existing upload for review.");},
  }}:{}),
 };
}
