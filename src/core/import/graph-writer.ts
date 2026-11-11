// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Admission for the guarded writer, not caller authorization or impersonation.
import { sql } from "drizzle-orm";
import type { Tx } from "@/core/service";

const enabled = new WeakSet<object>();
export async function markImportGraphWriter(tx: Tx): Promise<void> {
  if (enabled.has(tx)) return;
  await tx.execute(sql`select set_config('freeholder.import_graph_writer', 'v1', true)`);
  enabled.add(tx);
}

export async function markGraphRunWriter(tx: Tx, run: { checkpoint: unknown }): Promise<void> {
  const checkpoint = run.checkpoint && typeof run.checkpoint === "object" ? run.checkpoint as Record<string, unknown> : {};
  if (checkpoint.sourceGraph || checkpoint.sourceGraphBatch) await markImportGraphWriter(tx);
}
