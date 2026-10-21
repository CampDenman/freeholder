// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C11.14: permanent record deletion respects active privacy retention holds.
import { sql, type SQLWrapper } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import { dataRequests, privacyRetentionExceptions } from "@/core/privacy/schema";

export function withoutPrivacyHold(contactId: SQLWrapper, scope: string) {
  return sql`not exists (
    select 1 from ${privacyRetentionExceptions}
    inner join ${dataRequests} on ${dataRequests.id} = ${privacyRetentionExceptions.dataRequestId}
    where ${dataRequests.contactId} = ${contactId}
      and ${privacyRetentionExceptions.scope} = ${scope}
      and (${privacyRetentionExceptions.expiresAt} is null or ${privacyRetentionExceptions.expiresAt} > now())
  )`;
}

/**
 * A parent whose deletion would cascade into a held person's data.
 *
 * `withoutPrivacyHold` guards a record's *own* contact column; this guards the
 * child rows that a purge would take with it — a form's submissions, a
 * popup's events, a segment's captured membership. MASTER.md's erasure rule
 * states the obligation: holds protect parent rows whose deletion would
 * cascade into held data. The scope names the child's registered privacy
 * source, so an unrelated hold on the same person does not block purging
 * rows of data they never held.
 */
export function withoutHoldCascade(
  childTable: PgTable,
  childParentId: PgColumn,
  parentId: SQLWrapper,
  childContactId: PgColumn,
  scope: string,
) {
  return sql`not exists (
    select 1 from ${childTable}
    inner join ${dataRequests} on ${dataRequests.contactId} = ${childContactId}
    inner join ${privacyRetentionExceptions}
      on ${privacyRetentionExceptions.dataRequestId} = ${dataRequests.id}
    where ${childParentId} = ${parentId}
      and ${privacyRetentionExceptions.scope} = ${scope}
      and (${privacyRetentionExceptions.expiresAt} is null or ${privacyRetentionExceptions.expiresAt} > now())
  )`;
}
