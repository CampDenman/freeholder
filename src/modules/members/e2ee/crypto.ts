// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.39: the same pinned OpenMLS parser and RustCrypto operations on every runtime.
import initialize, { initSync, operate } from "../../../../public/_freeholder/openmls/0.1.0/freeholder_openmls.js";

let initialized = false;
let initializing: Promise<void> | undefined;
export function initializeOpenMls(bytes: Uint8Array): void {
  if (!initialized) {
    initSync({ module: bytes });
    initialized = true;
  }
}
export async function openMls<T>(request: Record<string, unknown>): Promise<T> {
  if (!initialized) {
    initializing ??= initialize({ module_or_path: "/_freeholder/openmls/0.1.0/freeholder_openmls_bg.wasm" }).then(() => { initialized = true; }).catch((error: unknown) => {
      initializing = undefined;
      throw error;
    });
    await initializing;
  }
  return JSON.parse(operate(JSON.stringify(request))) as T;
}
