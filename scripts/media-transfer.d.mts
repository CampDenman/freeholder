// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
export interface TransferStore {
  get(key: string): Promise<Uint8Array<ArrayBuffer> | undefined>;
  put(key: string, bytes: Uint8Array<ArrayBuffer>, contentType: string): Promise<void>;
}

export interface TransferRevision {
  kind: "etag" | "generation";
  key: string;
  namespace: string;
  value: string;
  versionId?: string;
}
export interface VersionedTransferStore extends TransferStore {
  accounted?(observer:TransferRequestObserver):AccountedTransferStore;
  binding: { kind: "s3" | "replit"; namespace: string; location: Readonly<Record<string,string>> };
  readVersioned(key: string, expectedRevision?:TransferRevision): Promise<{body:Uint8Array<ArrayBuffer>;contentType:string;revision:TransferRevision;requestProof?:OriginalProviderRequestProof}|undefined>;
  deleteVersioned(key: string, revision: TransferRevision): Promise<void>;
}

export function createS3Store(
  environment: Record<string, string | undefined>,
  prefix: string,
  options?: { allowInsecureHttp?: boolean; warn?: (message: string) => void },
): VersionedTransferStore;

export interface MediaTransferManifest {
  format: "freeholder-media-manifest/v1";
  objects: Array<{ key: string; bytes: number; contentType?: string; assetId?: string; checksumSha256?: string | null }>;
  assets?: Array<{ id?: string; storageKey: string; checksumSha256?: string | null }>;
  integrity?: { missingInventoryKeys?: string[] };
}

export function createReplitStore(environment: Record<string, string | undefined>, prefix: string): Promise<VersionedTransferStore>;

export function copyManifestObjects(options: {
  manifest: MediaTransferManifest;
  source: TransferStore;
  target: TransferStore;
  dryRun?: boolean;
}): Promise<{ objects: number; bytes: number; dryRun: boolean; skipped: number }>;

export interface TransferRequestDescriptor {
 kind:"object.read"|"object.metadata"|"object.body"|"object.put"|"object.delete"|"bucket.metadata"|"inventory.objects"|"inventory.versions"|"inventory.sessions"|"inventory.retained"|"multipart.create"|"multipart.inspect"|"multipart.complete"|"multipart.abort"|"multipart.sign";
 binding:VersionedTransferStore["binding"];key?:string;expectedRevision?:TransferRevision;
 createOnly?:boolean;sha256?:string;bytes?:number;cursor?:Record<string,string>|null;
 uploadId?:string;partsDigest?:string;contentType?:string;partNumber?:number;expiresAt?:string;checksumAlgorithm?:"SHA256";checksumType?:"COMPOSITE";
}
export interface OriginalProviderRequestProof {id:string;tokenDigest:string}
export interface TransferRequestIdentity {id:string;token:string}
export interface TransferRequestObservation {
 stage:"response"|"metadata"|"body"|"accepted"|"absence"|"inventory"|"configuration"|"not_attempted"|"inventory_raw"|"session"|"response_body"|"capability"|"parts_verified";
 status:number|null;uploadId?:string;requestProof?:OriginalProviderRequestProof;detailDigest?:string;revision?:TransferRevision;sha256?:string;bytes?:number;count?:number;expiresAt?:string;
 partPageIds?:string[];
 partsDigest?:string;
 capabilityProof?:import('./media-part-capability.mjs').OriginalPartCapabilityProof;
}
export type TransferRequestObserver=<T>(descriptor:TransferRequestDescriptor,operation:(notify:(facts:TransferRequestObservation)=>Promise<void>,identity?:TransferRequestIdentity)=>Promise<T>)=>Promise<T>;
export interface TransferInventoryEntry {
 kind:"object"|"version"|"delete_marker"|"session"|"retained";key:string;bytes:number;
 revision?:TransferRevision;versionId?:string;sessionId?:string;current:boolean;
}
export interface TransferInventoryPage {entries:TransferInventoryEntry[];next:Record<string,string>|null}
export interface TransferInventoryConfiguration {versioning:"disabled"|"Enabled"|"Suspended";softDeleteSeconds:number;retentionSeconds:number}
export interface AccountedTransferStore extends VersionedTransferStore {
 /** A complete original pinned body is hashed with bounded memory. This is
  * read evidence, never completion/consumption or original caller FIN. */
 readDigestVersioned?(key:string,revision:TransferRevision,maxBytes:number,originalParts?:readonly import("./media-multipart-readback.mjs").OriginalMultipartReadbackPart[]):Promise<{sha256:string;bytes:number;partsDigest?:string;contentType:string;revision:TransferRevision;requestProof?:OriginalProviderRequestProof}|undefined>;
 inventoryPage(kind:"objects"|"versions"|"sessions"|"retained",cursor?:Record<string,string>|null):Promise<TransferInventoryPage>;
 inventoryConfiguration():Promise<TransferInventoryConfiguration>;
}
