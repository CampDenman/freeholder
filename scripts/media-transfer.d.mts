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
}
export interface VersionedTransferStore extends TransferStore {
  binding: { kind: "s3" | "replit"; namespace: string; location: Readonly<Record<string,string>> };
  readVersioned(key: string): Promise<{body:Uint8Array<ArrayBuffer>;contentType:string;revision:TransferRevision}|undefined>;
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
