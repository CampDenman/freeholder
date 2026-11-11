// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Populate historical shapes explicitly; boundary tests keep the real guards on.
import { sql } from "drizzle-orm";
import { db } from "@/core/db";
import type { Tx } from "@/core/service";
import { mailReceipts } from "@/core/mail/receipts";

export function historicalMailFixture<T>(write: (tx: Tx) => Promise<T>): Promise<T> {
  return db().transaction(async tx => {
    // Fixture maintenance is authorized to create pre-journal historical
    // facts. It does not initialize a modern receipt or fabricate its owner.
    await tx.execute(sql`select set_config('freeholder.mail_dispatch_v1','1',true)`);
    return write(tx);
  });
}

export function currentMailFixture<T>(write: (tx: Tx) => Promise<T>): Promise<T> {
  return db().transaction(async tx => { await mailReceipts(tx); return write(tx); });
}
