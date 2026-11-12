// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.31: forget the address, preserve minimal original HTTP receipts.
import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import type { Tx } from "@/core/service";
import { admitCarrierWrites } from "./carrier-operations";
import { mailProviderGrants } from "./schema";

/** The caller supplies eligible unheld grants; only confirmed withdrawals minimize. */
export async function minimizeCarrierGrants(tx: Tx, ids: readonly string[]): Promise<number> {
  if (!ids.length) return 0;
  const receipts = await admitCarrierWrites(tx);
  const rows = await tx.select().from(mailProviderGrants).where(and(inArray(mailProviderGrants.id, [...ids]), isNotNull(mailProviderGrants.withdrawnAt), isNull(mailProviderGrants.redactedAt))).orderBy(mailProviderGrants.id).for("update");
  for (const row of rows) await tx.update(mailProviderGrants).set({ email: "", emailDigest: receipts.digest("address", row.email), consentRecordId: null, withdrawalError: null, redactedAt: new Date(), updatedAt: new Date() }).where(eq(mailProviderGrants.id, row.id));
  return rows.length;
}
