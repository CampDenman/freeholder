// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Only fictional provider evidence for the exact, stopped test operation.
import { and, eq } from "drizzle-orm";
import { expect } from "vitest";
import { db } from "@/core/db";
import { mediaObjectWrites } from "@/core/media/write-schema";
import { reconcileStorageOperation } from "@/core/media/write-recovery";
import { OWNER } from "./spine";

export async function confirmStoppedUnappliedDelete(key: string): Promise<void> {
  const [operation] = await db().select().from(mediaObjectWrites).where(and(
    eq(mediaObjectWrites.key, key), eq(mediaObjectWrites.operation, "delete"), eq(mediaObjectWrites.state, "unknown"),
  ));
  expect(operation).toBeDefined();
  expect(operation!.observedAcceptedAt).toBeNull();
  const evidence = {
    id: operation!.id, expectedUpdatedAt: operation!.updatedAt.toISOString(), originalNamespace: operation!.namespace!, outcome: "not_applied" as const,
    providerFinalReference: "synthetic-source-delete-final-reference",
    providerEvidence: "The fictional provider confirms this exact DELETE did not apply; original bytes remain.",
    stoppedWriterEvidence: "The synthetic rejected DELETE has returned and its original provider work was confirmed stopped.",
    confirmation: "ORIGINAL STORAGE OUTCOME CONFIRMED" as const,
  };
  const security = { twoFactorRequired: false, twoFactorEnrolled: true, twoFactorVerified: true, stepUpValid: true };
  await expect(reconcileStorageOperation.call(evidence, { ...OWNER, security: { ...security, stepUpValid: false } })).rejects.toMatchObject({ code: "step_up_required" });
  await reconcileStorageOperation.call(evidence, { ...OWNER, security });
}
