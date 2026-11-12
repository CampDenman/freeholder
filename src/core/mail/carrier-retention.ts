// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.31: forget the address, preserve minimal original HTTP receipts.
import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { lockContactIdentityForRead } from "@/core/contacts/identity-lock";
import { consentRecords, dataRequests, privacyRetentionExceptions } from "@/core/privacy/schema";
import type { Tx } from "@/core/service";
import { admitCarrierWrites } from "./carrier-operations";
import { mailProviderGrants } from "./schema";

/** Confirm withdrawal and current holds again at the actual minimization boundary. */
export async function minimizeCarrierGrants(tx: Tx, ids: readonly string[]): Promise<number> {
  if (!ids.length) return 0;
  // Hold creation, merge and privacy cutovers take the exclusive identity lock.
  // The retention runner's earlier exemption snapshot is not final authority.
  await lockContactIdentityForRead(tx);
  const receipts = await admitCarrierWrites(tx);
  const holds = await tx.select({ contactId: dataRequests.contactId }).from(privacyRetentionExceptions).innerJoin(dataRequests, eq(dataRequests.id, privacyRetentionExceptions.dataRequestId)).where(and(inArray(privacyRetentionExceptions.scope, ["mail.provider_grants", "privacy.records"]), sql`(${privacyRetentionExceptions.expiresAt} is null or ${privacyRetentionExceptions.expiresAt}>clock_timestamp())`));
  const held = new Set(holds.map(row => row.contactId));
  const rows = await tx.select().from(mailProviderGrants).where(and(inArray(mailProviderGrants.id, [...ids]), isNotNull(mailProviderGrants.withdrawnAt), isNull(mailProviderGrants.redactedAt))).orderBy(mailProviderGrants.id).for("update");
  const consentIds = rows.flatMap(row => row.consentRecordId ? [row.consentRecordId] : []);
  const requestIds = rows.flatMap(row => row.erasureRequestId ? [row.erasureRequestId] : []);
  const consents = consentIds.length ? await tx.select({ id: consentRecords.id, contactId: consentRecords.contactId }).from(consentRecords).where(inArray(consentRecords.id, consentIds)) : [];
  const requests = requestIds.length ? await tx.select({ id: dataRequests.id, contactId: dataRequests.contactId }).from(dataRequests).where(inArray(dataRequests.id, requestIds)) : [];
  let minimized = 0;
  for (const row of rows) {
    const owners = new Set([consents.find(item => item.id === row.consentRecordId)?.contactId, requests.find(item => item.id === row.erasureRequestId)?.contactId].filter((id): id is string => Boolean(id)));
    // No email/current-address inference can prove a legacy orphan is outside
    // a named hold. Known unrelated grants remain independently eligible.
    if ((held.size && !owners.size) || [...owners].some(id => held.has(id))) continue;
    await tx.update(mailProviderGrants).set({ email: "", emailDigest: receipts.digest("address", row.email), consentRecordId: null, withdrawalError: null, redactedAt: new Date(), updatedAt: new Date() }).where(eq(mailProviderGrants.id, row.id));
    minimized++;
  }
  return minimized;
}
