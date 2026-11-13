// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.12/C11.08: shared deletion/recovery boundary, outside business TXs.
import type { StorageAdapter } from "@/adapters/storage/types";
import { ServiceError } from "@/core/service";

export async function assertPhysicalStorageAbsence(store: StorageAdapter, key: string): Promise<void> {
  if (!store.verifyPhysicalAbsence) throw new ServiceError("conflict", "This provider cannot yet prove all original versions and upload sessions absent. Keep the original receipts for recovery.");
  try { await store.verifyPhysicalAbsence(key); }
  catch { throw new ServiceError("conflict", "Complete physical absence is not verified. Retained versions, soft-deleted bytes or upload sessions may remain; keep the original receipts for recovery."); }
}
