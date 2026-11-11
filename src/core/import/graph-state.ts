// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { and, eq } from "drizzle-orm";
import { importSourceGraphs } from "@/core/plugins/schema";
import type { Tx } from "@/core/service";

/** Call under the owning run lock; its private source can no longer advance. */
export async function invalidateImportGraph(tx: Tx, run: { id: string }): Promise<void> {
  await tx.update(importSourceGraphs).set({ state: "invalidated", leaseToken: null, leaseActor: null, leaseUntil: null, updatedAt: new Date() }).where(and(eq(importSourceGraphs.runId, run.id)));
}
