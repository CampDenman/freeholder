// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: a compatibility ABI for the guarded shared refund phases, not a DB ACL.
import { sql } from "drizzle-orm";
import type { Tx } from "@/core/service";
export async function allowOriginalMerchantRefundWrites(tx: Tx): Promise<void> {
  await tx.execute(sql`select set_config('freeholder.merchant_refund_v1','1',true)`);
}
