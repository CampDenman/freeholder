// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C2.29/C11.10: original provider bytes are part of the erasure receipt.
import { z } from "zod";
import { storage } from "@/adapters/storage";
import { pendingObjectIsOwned } from "@/core/media/object-ledger";
import { completeErasureJob } from "@/core/privacy/service";

export const IMPORT_SOURCE_ERASURE_JOB = "core.eraseImportSourceObjects";
export const IMPORT_SOURCE_ERASURE_SCOPE = "imports.readerSources";
const payload = z.object({ requestId: z.uuid(), originalJobId: z.uuid(),
  keys: z.array(z.string().regex(/^imports\/[a-f0-9-]{36}\/[a-f0-9-]{36}\/\d{5}\.part$/)).min(1).max(25),
});
/** Only a durable worker calls this; provider work never holds the privacy TX. */
export async function eraseImportSourceObjects(data: Record<string, unknown>): Promise<{ erased: number }> {
  const input = payload.parse(data);
  const store = storage();
  if (store.isPublic) throw new Error("Private source erasure requires the original private storage configuration.");
  // An active window or unresolved PUT can still create bytes after deletion.
  // Neither a timeout nor GET-not-found is cancellation evidence.
  for (const key of input.keys) if (await pendingObjectIsOwned(key)) throw new Error("Source storage ownership or an unresolved provider write keeps erasure pending.");
  for (const key of input.keys) {
    await store.delete(key);
    if (await store.get(key)) throw new Error("The provider has not confirmed source-object removal; erasure remains pending.");
  }
  await completeErasureJob.call({ requestId: input.requestId, scope: IMPORT_SOURCE_ERASURE_SCOPE, jobId: input.originalJobId }, { kind: "system" });
  return { erased: input.keys.length };
}
