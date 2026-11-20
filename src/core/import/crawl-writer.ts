// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.47: private HTTP source ABI admission, never caller authorization.
import { sql } from "drizzle-orm";
import type { Tx } from "@/core/service";
import { markImportGraphWriter } from "./graph-writer";

export async function markImportCrawlWriter(tx: Tx): Promise<void> {
  await markImportGraphWriter(tx);
  await tx.execute(sql`select set_config('freeholder.import_crawl_writer','v1',true)`);
}
