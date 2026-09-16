// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C11.14: permanent record deletion respects active privacy retention holds.
import { sql, type SQLWrapper } from "drizzle-orm";
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
