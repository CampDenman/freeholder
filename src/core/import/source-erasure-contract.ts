// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C1.08/C3.47: a retained task is evidence of its exact keys, never a graph set.
import { z } from "zod";

export const IMPORT_SOURCE_ERASURE_JOB = "core.eraseImportSourceObjects";
export const IMPORT_SOURCE_ERASURE_SCOPE = "imports.readerSources";
export const IMPORT_SOURCE_RECONCILIATION_JOB = "core.reconcileImportSourceErasure";
export const originalSourceErasurePayload = z.object({ requestId: z.uuid(), originalJobId: z.uuid(),
  keys: z.array(z.string().regex(/^imports\/[a-f0-9-]{36}\/[a-f0-9-]{36}\/\d{5}\.part$/)).min(1).max(25),
});

export function originalUploadedTaskEvidence(data: unknown, jobId: string, requestId: string) {
  const parsed = originalSourceErasurePayload.safeParse(data);
  return parsed.success && parsed.data.originalJobId === jobId && parsed.data.requestId === requestId ? parsed.data : null;
}
