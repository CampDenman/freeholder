// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C10.32: provider I/O is outside every short ledger transaction.
import { randomUUID } from "node:crypto";
import type { StorageAdapter } from "./types";

export class StorageQuotaError extends Error {
  constructor(public readonly code: string) { super(code); }
}

export interface StorageQuotaLedger {
  reserve(key: string, bytes: number, token: string): Promise<void>;
  settle(key: string, bytes: number, token: string): Promise<void>;
}

/** No signed direct-upload URLs escape this wrapper. Until part sizes are
 * enforceable before provider I/O, native media truthfully uses its bounded
 * proxy fallback. Reads preserve all underlying privacy/expiry semantics.
 */
export function withStorageQuota(inner: StorageAdapter, ledger: StorageQuotaLedger): StorageAdapter {
  const valid = (key: string, bytes: number) => {
    if (!key || key.length > 2048 || key.includes("\0") || !Number.isSafeInteger(bytes) || bytes < 0) {
      throw new StorageQuotaError("storage_quota_invalid_object");
    }
  };
  return {
    id: inner.id, isPublic: inner.isPublic,writeProtocol:inner.writeProtocol,binding:inner.binding?.bind(inner),verifyPhysicalAbsence:inner.verifyPhysicalAbsence?key=>inner.verifyPhysicalAbsence!(key):undefined,
    get: key => inner.get(key), head: key => inner.head(key),
    readRange: (key, start, end) => inner.readRange(key, start, end),
    stream: key => inner.stream(key), url: (key, options) => inner.url(key, options),
    async put(key, body, contentType, observation) {
      valid(key, body.byteLength);
      // A caller may reuse or resize its buffer while the reservation awaits
      // PostgreSQL. Bind provider bytes to the accepted immutable snapshot.
      const snapshot=new Uint8Array(body),bytes=snapshot.byteLength;
      const token = randomUUID();
      await ledger.reserve(key, bytes, token);
      // Never release on a thrown/ambiguous provider reply: bytes may exist.
      const result = await inner.put(key, snapshot, contentType, observation);
      if (result.key !== key || result.bytes !== bytes) {
        throw new StorageQuotaError("storage_quota_provider_result_mismatch");
      }
      await ledger.settle(key, bytes, token);
      return result;
    },
    async delete(key) {
      valid(key, 0);
      const token = randomUUID();
      await ledger.reserve(key, 0, token);
      await inner.delete(key);
      // Existing bytes remain charged until the provider confirms deletion.
      await ledger.settle(key, 0, token);
    },
  };
}
