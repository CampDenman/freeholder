// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C11.08: only privately configured original resources; no credentials in input.
import {createS3Store,createReplitStore,type AccountedTransferStore} from "../../../scripts/media-transfer.mjs";
import {boundStorage} from "@/adapters/storage";
import {createS3Storage} from "@/adapters/storage/s3";
import {createReplitStorage} from "@/adapters/storage/replit";
import type {StorageAdapter,StorageBinding} from "@/adapters/storage/types";
import {env} from "@/core/env";
import {observeTransferRequest} from "./transfer-requests";
import {checkedTransferBinding} from "./transfer-witness";
import {currentServiceTransaction} from "@/core/plugins/context";
import {storageNamespace} from "./storage-quota";
import {storage} from "@/adapters/storage";
import {transferConflict,transferDigest} from "./transfer-proof";

export async function configuredTransferStores():Promise<{source:AccountedTransferStore;target:AccountedTransferStore}> {
 const e=env(),configured=await boundStorage();
 if(configured.store.isPublic||!["s3","replit"].includes(configured.binding.kind))transferConflict("Verified transfer requires the configured original private S3 or Replit storage.");
 const explicit=e.MEDIA_TRANSFER_SOURCE_STORAGE!==undefined,sourceKind=e.MEDIA_TRANSFER_SOURCE_STORAGE??configured.binding.kind;
 const sourceEnvironment:Record<string,string|undefined>={SOURCE_S3_ENDPOINT:explicit?e.MEDIA_TRANSFER_SOURCE_S3_ENDPOINT:e.S3_ENDPOINT,SOURCE_S3_REGION:explicit?e.MEDIA_TRANSFER_SOURCE_S3_REGION:e.S3_REGION,SOURCE_S3_BUCKET:explicit?e.MEDIA_TRANSFER_SOURCE_S3_BUCKET:e.S3_BUCKET,SOURCE_S3_ACCESS_KEY_ID:explicit?e.MEDIA_TRANSFER_SOURCE_S3_ACCESS_KEY_ID:e.S3_ACCESS_KEY_ID,SOURCE_S3_SECRET_ACCESS_KEY:explicit?e.MEDIA_TRANSFER_SOURCE_S3_SECRET_ACCESS_KEY:e.S3_SECRET_ACCESS_KEY,SOURCE_S3_ADDRESSING_STYLE:explicit?e.MEDIA_TRANSFER_SOURCE_S3_ADDRESSING_STYLE:e.S3_ADDRESSING_STYLE,SOURCE_REPLIT_BUCKET_ID:explicit?e.MEDIA_TRANSFER_SOURCE_REPLIT_BUCKET_ID:e.REPLIT_BUCKET_ID,SOURCE_S3_ALLOW_LOOPBACK_HTTP:e.NODE_ENV==="test"?"true":undefined};
 const targetEnvironment:Record<string,string|undefined>={TARGET_S3_ENDPOINT:e.MEDIA_TRANSFER_TARGET_S3_ENDPOINT,TARGET_S3_REGION:e.MEDIA_TRANSFER_TARGET_S3_REGION,TARGET_S3_BUCKET:e.MEDIA_TRANSFER_TARGET_S3_BUCKET,TARGET_S3_ACCESS_KEY_ID:e.MEDIA_TRANSFER_TARGET_S3_ACCESS_KEY_ID,TARGET_S3_SECRET_ACCESS_KEY:e.MEDIA_TRANSFER_TARGET_S3_SECRET_ACCESS_KEY,TARGET_S3_ADDRESSING_STYLE:e.MEDIA_TRANSFER_TARGET_S3_ADDRESSING_STYLE,TARGET_REPLIT_BUCKET_ID:e.MEDIA_TRANSFER_TARGET_REPLIT_BUCKET_ID,TARGET_S3_ALLOW_LOOPBACK_HTTP:e.NODE_ENV==="test"?"true":undefined};
 const source=sourceKind==="s3"?createS3Store(sourceEnvironment,"SOURCE"):await createReplitStore(sourceEnvironment,"SOURCE");
 const target=e.MEDIA_TRANSFER_TARGET_STORAGE==="s3"?createS3Store(targetEnvironment,"TARGET"):e.MEDIA_TRANSFER_TARGET_STORAGE==="replit"?await createReplitStore(targetEnvironment,"TARGET"):transferConflict("Configure the explicit private transfer destination before planning a transfer.");
 checkedTransferBinding(source.binding);checkedTransferBinding(target.binding);
 if((!explicit&&transferDigest(source.binding)!==transferDigest(configured.binding))||source.binding.namespace===target.binding.namespace)transferConflict("The configured transfer resources do not match distinct original private resources.");
 if(!source.accounted||!target.accounted)transferConflict("The original resources do not support accountable physical requests.");
 return{source:source.accounted(observeTransferRequest),target:target.accounted(observeTransferRequest)};
}
export async function configuredPhysicalStorage(binding:StorageBinding):Promise<StorageAdapter> {
 const e=env();
 if(e.MEDIA_TRANSFER_TARGET_STORAGE==="s3"&&binding.kind==="s3"&&e.MEDIA_TRANSFER_TARGET_S3_ENDPOINT&&e.MEDIA_TRANSFER_TARGET_S3_BUCKET&&binding.namespace===storageNamespace({id:"s3",endpoint:e.MEDIA_TRANSFER_TARGET_S3_ENDPOINT,bucket:e.MEDIA_TRANSFER_TARGET_S3_BUCKET}))return createS3Storage({endpoint:e.MEDIA_TRANSFER_TARGET_S3_ENDPOINT,region:e.MEDIA_TRANSFER_TARGET_S3_REGION!,bucket:e.MEDIA_TRANSFER_TARGET_S3_BUCKET,accessKeyId:e.MEDIA_TRANSFER_TARGET_S3_ACCESS_KEY_ID!,secretAccessKey:e.MEDIA_TRANSFER_TARGET_S3_SECRET_ACCESS_KEY!,addressingStyle:e.MEDIA_TRANSFER_TARGET_S3_ADDRESSING_STYLE,isPublic:false});
 if(e.MEDIA_TRANSFER_TARGET_STORAGE==="replit"&&binding.kind==="replit"&&e.MEDIA_TRANSFER_TARGET_REPLIT_BUCKET_ID&&binding.namespace===storageNamespace({id:"replit",bucket:e.MEDIA_TRANSFER_TARGET_REPLIT_BUCKET_ID}))return createReplitStorage({bucketId:e.MEDIA_TRANSFER_TARGET_REPLIT_BUCKET_ID,mediaPath:"/media"});
 const current=storage();
 const matchesCurrent=binding.kind==="s3"&&current.id==="s3"&&binding.namespace===storageNamespace({id:"s3",endpoint:e.S3_ENDPOINT,bucket:e.S3_BUCKET})||binding.kind==="replit"&&current.id==="replit"&&e.REPLIT_BUCKET_ID&&binding.namespace===storageNamespace({id:"replit",bucket:e.REPLIT_BUCKET_ID});
 if(matchesCurrent){if(current.isPublic)transferConflict("The original physical copy requires private configured storage.");return current;}
 if(currentServiceTransaction())transferConflict("Restore the exact explicit original private resource before resolving its physical key.");
 const captured=await boundStorage();if(!captured.store.isPublic&&transferDigest(captured.binding)===transferDigest(binding))return captured.store;
 return transferConflict("Restore the exact configured original transfer resource before reading this object.");
}

/** A single exact original resource for ordinary recovery. Credentials come
 * only from private configured slots; callers cannot supply a host/account.
 * Resolve outside a business transaction, then bind the resulting factory to
 * the immutable original namespace/location before any physical request. */
export async function configuredOriginalRequestStore(binding:StorageBinding):Promise<AccountedTransferStore>{
 if(currentServiceTransaction())transferConflict("Resolve the original private provider outside the business transaction.");
 checkedTransferBinding(binding);const e=env();
 const candidates=binding.kind==="s3"?[
  {kind:"s3"as const,endpoint:e.S3_ENDPOINT,region:e.S3_REGION,bucket:e.S3_BUCKET,access:e.S3_ACCESS_KEY_ID,secret:e.S3_SECRET_ACCESS_KEY,style:e.S3_ADDRESSING_STYLE},
  {kind:"s3"as const,endpoint:e.MEDIA_TRANSFER_SOURCE_S3_ENDPOINT,region:e.MEDIA_TRANSFER_SOURCE_S3_REGION,bucket:e.MEDIA_TRANSFER_SOURCE_S3_BUCKET,access:e.MEDIA_TRANSFER_SOURCE_S3_ACCESS_KEY_ID,secret:e.MEDIA_TRANSFER_SOURCE_S3_SECRET_ACCESS_KEY,style:e.MEDIA_TRANSFER_SOURCE_S3_ADDRESSING_STYLE},
  {kind:"s3"as const,endpoint:e.MEDIA_TRANSFER_TARGET_S3_ENDPOINT,region:e.MEDIA_TRANSFER_TARGET_S3_REGION,bucket:e.MEDIA_TRANSFER_TARGET_S3_BUCKET,access:e.MEDIA_TRANSFER_TARGET_S3_ACCESS_KEY_ID,secret:e.MEDIA_TRANSFER_TARGET_S3_SECRET_ACCESS_KEY,style:e.MEDIA_TRANSFER_TARGET_S3_ADDRESSING_STYLE},
 ]:[];
 for(const candidate of candidates){
  if(!candidate.endpoint||!candidate.bucket||!candidate.region||!candidate.access||!candidate.secret||storageNamespace({id:"s3",endpoint:candidate.endpoint,bucket:candidate.bucket})!==binding.namespace)continue;
  const store=createS3Store({ORIGINAL_S3_ENDPOINT:candidate.endpoint,ORIGINAL_S3_REGION:candidate.region,ORIGINAL_S3_BUCKET:candidate.bucket,ORIGINAL_S3_ACCESS_KEY_ID:candidate.access,ORIGINAL_S3_SECRET_ACCESS_KEY:candidate.secret,ORIGINAL_S3_ADDRESSING_STYLE:candidate.style,ORIGINAL_S3_ALLOW_LOOPBACK_HTTP:e.NODE_ENV==="test"?"true":undefined},"ORIGINAL");
  if(transferDigest(store.binding)!==transferDigest(binding)||!store.accounted)transferConflict("The configured provider differs from its exact original binding.");return store.accounted(observeTransferRequest);
 }
 if(binding.kind==="replit")for(const bucket of [e.REPLIT_BUCKET_ID,e.MEDIA_TRANSFER_SOURCE_REPLIT_BUCKET_ID,e.MEDIA_TRANSFER_TARGET_REPLIT_BUCKET_ID]){
  if(!bucket||storageNamespace({id:"replit",bucket})!==binding.namespace)continue;
  const store=await createReplitStore({ORIGINAL_REPLIT_BUCKET_ID:bucket},"ORIGINAL");if(transferDigest(store.binding)!==transferDigest(binding)||!store.accounted)transferConflict();return store.accounted(observeTransferRequest);
 }
 return transferConflict("Restore the exact original privately configured provider resource. A current account/key cannot rebind its namespace.");
}
