// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// What `mail_provider_grants` owes the privacy and retention registries
// (C3.31). Imported for the side effect at boot, like `core/runs/spine`.
//
// A grant row holds the address a campaign carrier knows a person by, so it
// is the person's data: exported with them, and erased with them. Erasure
// cannot simply delete it, because the carrier still holds a grant for that
// address; it detaches the open grants from the contact, queues one job that
// withdraws them at the carrier and then deletes the rows, and reports that
// job as pending on the erasure receipt until it has finished.
import { and, asc, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { enqueueJob } from "@/core/jobs";
import { mailProviderGrants } from "@/core/mail/schema";
import { registerContactPrivacySource } from "@/core/privacy/service";
import { consentRecords } from "@/core/privacy/schema";
import { db } from "@/core/db";
import { registerRetentionSource, RETENTION_PURGE_BATCH } from "@/core/retention/registry";
import type { Tx } from "@/core/service";

export const PROVIDER_GRANTS_SCOPE = "mail.provider_grants";

function grantsOf(tx: Tx, contactId: string) {
  return tx
    .select({
      id: mailProviderGrants.id,
      provider: mailProviderGrants.provider,
      email: mailProviderGrants.email,
      consentRecordId: mailProviderGrants.consentRecordId,
      withdrawnAt: mailProviderGrants.withdrawnAt,
      withdrawalError: mailProviderGrants.withdrawalError,
      createdAt: mailProviderGrants.createdAt,
    })
    .from(mailProviderGrants)
    .innerJoin(consentRecords, eq(consentRecords.id, mailProviderGrants.consentRecordId))
    .where(eq(consentRecords.contactId, contactId))
    .orderBy(asc(mailProviderGrants.createdAt));
}

registerContactPrivacySource({
  scope: PROVIDER_GRANTS_SCOPE,
  tables: ["mail_provider_grants"],
  // Consent evidence is the grant's parent; a hold on it holds the grant too.
  retentionScopes: ["privacy.records"],
  exportData: (tx, contactId) => grantsOf(tx, contactId),
  erase: async (tx, contactId, context) => {
    const grants = await grantsOf(tx, contactId);
    if (grants.length === 0) return { affected: 0 };
    const finished = grants.filter((grant) => grant.withdrawnAt || grant.withdrawalError);
    const open = grants.filter((grant) => !grant.withdrawnAt && !grant.withdrawalError);
    if (finished.length) {
      await tx.delete(mailProviderGrants).where(inArray(mailProviderGrants.id, finished.map((grant) => grant.id)));
    }
    if (open.length === 0) return { affected: grants.length };
    // Detached: no longer linked to the person, kept only until the carrier
    // has been told, then deleted by the job.
    const job = await enqueueJob(
      tx,
      "core.withdrawProviderGrants",
      { grantIds: open.map((grant) => grant.id) },
      { idempotencyKey: `provider-grants-erasure:${context.requestId}` },
    );
    // The rows remember which erasure waits on them, so whichever run
    // finishes them — this job, or the sweep once credentials are back —
    // acknowledges the receipt.
    await tx
      .update(mailProviderGrants)
      .set({
        consentRecordId: null,
        erasureRequestId: context.requestId,
        erasureJobId: job.id,
        updatedAt: new Date(),
      })
      .where(inArray(mailProviderGrants.id, open.map((grant) => grant.id)));
    return { affected: grants.length, pendingJobs: [job.id] };
  },
});

/**
 * Finished grants (withdrawn, or refused permanently) age out. Open grants
 * never do: the carrier still holds them, and a later withdrawal needs them.
 */
registerRetentionSource({
  kind: "mail_provider_grants",
  tables: ["mail_provider_grants"],
  privacyScope: PROVIDER_GRANTS_SCOPE,
  purge: async (args) => {
    let purged = 0;
    for (;;) {
      const finishedBefore = and(
        or(isNotNull(mailProviderGrants.withdrawnAt), isNotNull(mailProviderGrants.withdrawalError)),
        sql`${mailProviderGrants.updatedAt} < ${args.cutoff.toISOString()}::timestamptz`,
        args.exceptContactIds.length
          ? or(
              isNull(mailProviderGrants.consentRecordId),
              sql`not exists (select 1 from ${consentRecords} where ${consentRecords.id} = ${mailProviderGrants.consentRecordId} and ${inArray(consentRecords.contactId, [...args.exceptContactIds])})`,
            )
          : undefined,
      );
      const batch = await db()
        .select({ id: mailProviderGrants.id })
        .from(mailProviderGrants)
        .where(finishedBefore)
        .limit(RETENTION_PURGE_BATCH);
      if (batch.length === 0) break;
      const deleted = await db()
        .delete(mailProviderGrants)
        .where(and(inArray(mailProviderGrants.id, batch.map((row) => row.id)), finishedBefore))
        .returning({ id: mailProviderGrants.id });
      purged += deleted.length;
      if (batch.length < RETENTION_PURGE_BATCH) break;
    }
    return purged;
  },
});
