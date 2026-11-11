// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { expect, it, vi } from "vitest";
import "@/modules/members/e2ee/server-init";
import { openMls } from "@/modules/members/e2ee/crypto";
import { readKeyPackage } from "@/modules/members/e2ee/wire";
it.each([false, true])("verifies Rust packages through the common wire adapter (last resort: %s)",async(lastResort)=>{
 const keys=await openMls<{privateKey:string;publicKey:string}>({op:"generateKeys"});
 const identity={userId:"00000000-0000-4000-8000-0000000000c1",deviceId:crypto.randomUUID(),...keys};
 const kp=await openMls<{publicPackage:string}>({op:"makeKeyPackage",identity,lastResort});
 expect(await openMls({op:"readKeyPackage",encoded:kp.publicPackage})).toEqual({identity:identity.userId+":"+identity.deviceId,signatureKey:keys.publicKey});
 expect(await readKeyPackage(kp.publicPackage)).not.toBeNull();
});

// Persisted sender state must be mutually exclusive across browser tabs.
it("refuses a browser without cross-tab locking instead of reusing a sender state",async()=>{
  const { E2eeDevice } = await import("@/modules/members/e2ee/engine");
  const { memoryStore } = await import("../helpers/e2ee-store");
  const transport = {} as unknown as ConstructorParameters<typeof E2eeDevice>[2];
  vi.stubGlobal("window", {});
  vi.stubGlobal("navigator", {});
  try {
    const device = new E2eeDevice("00000000-0000-4000-8000-000000000001", memoryStore(), transport, "Synthetic device");
    await expect(device.device()).rejects.toMatchObject({ code: "not_ready" });
  } finally { vi.unstubAllGlobals(); }
});
