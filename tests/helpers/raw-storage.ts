// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Fixture-only byte seeding, and why it does not go through `storage()`.
//
// `storage()` wraps its adapter in `withManagedStorageMutations`
// (`src/adapters/storage/managed.ts`), which refuses any put/delete that does
// not carry a genuine committed original caller: the observer must be
// identically `observeTransferRequest` with an active scope backed by a
// server-held `media_storage_transfer_calls` row matching the key, kind and
// token digest. That is deliberate — every physical byte write in the product
// must be attributable to a real caller — and a fixture cannot fake it, nor
// should it be able to.
//
// `managed.ts` keeps the escape it intends for exactly this case: "standalone
// low-level provider factories retain their operator/test contract." So a
// fixture that needs bytes on disk builds the low-level local provider
// directly. It writes to the same `LOCAL_STORAGE_ROOT` the application reads
// from, without claiming storage authority it does not have.
//
// Use this ONLY to arrange or clean up fixture bytes. Anything a test is
// actually asserting about upload, recovery or erasure must go through the
// owning service, or it is not testing the product.
import { createLocalStorage } from "@/adapters/storage/local";
import { MEDIA_PATH } from "@/adapters/storage";
import type { StorageAdapter } from "@/adapters/storage/types";

export function fixtureStorage(): StorageAdapter {
  return createLocalStorage({
    root: process.env.LOCAL_STORAGE_ROOT ?? ".data/media",
    publicPath: MEDIA_PATH,
  });
}
