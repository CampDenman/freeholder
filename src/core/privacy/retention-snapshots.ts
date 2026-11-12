// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.08/C3.47: these are capture receipts, never guessed original membership.
import { and, eq, gt, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import { ServiceError, type ServiceContext, type Tx } from "@/core/service";
import { contactPrivacySources } from "./service";
import { dataRequests, privacyRetentionExceptions } from "./schema";
import { privacyRetentionSourceMembers, privacyRetentionSourceSnapshots } from "./retention-schema";
type SnapshotReader = Pick<Tx, "select">;

export async function retentionSourceSnapshotIsComplete(tx: SnapshotReader, exceptionId: string, sourceScope: string): Promise<boolean> {
  const [row] = await tx.select({ version: privacyRetentionSourceSnapshots.captureVersion, expected: privacyRetentionSourceSnapshots.memberCount,
    actual: sql<number>`(select count(*)::integer from privacy_retention_source_members m where m.exception_id=${privacyRetentionSourceSnapshots.exceptionId} and m.source_scope=${privacyRetentionSourceSnapshots.sourceScope})` }).from(privacyRetentionSourceSnapshots)
    .where(and(eq(privacyRetentionSourceSnapshots.exceptionId, exceptionId), eq(privacyRetentionSourceSnapshots.sourceScope, sourceScope))).limit(1);
  return row?.version === 1 && row.expected === row.actual;
}

/** Call after every original member is captured in this real parent TX.
 * Updates cannot backfill an unknown historical hold as an empty capture.
 */
export async function completeRetentionSourceSnapshot(service: ServiceContext, input: { exceptionId: string; requestId: string; sourceScope: string; isNew: boolean; members: readonly { sourceId: string; generation: string }[] }): Promise<void> {
  const source = contactPrivacySources().find(item => item.scope === input.sourceScope);
  const [hold] = await service.tx.select({ scope: privacyRetentionExceptions.scope, kind: dataRequests.kind }).from(privacyRetentionExceptions)
    .innerJoin(dataRequests, eq(dataRequests.id, privacyRetentionExceptions.dataRequestId))
    .where(and(eq(privacyRetentionExceptions.id, input.exceptionId), eq(privacyRetentionExceptions.dataRequestId, input.requestId))).limit(1);
  if (!source || !hold || hold.kind !== "erasure" || ![source.scope, ...(source.retentionScopes ?? [])].includes(hold.scope)) throw new ServiceError("permission", "That original hold does not cover this registered data source.");
  if (await retentionSourceSnapshotIsComplete(service.tx, input.exceptionId, input.sourceScope)) return;
  if (!input.isNew) throw new ServiceError("conflict", "Review the original retention scope before changing this historical hold.");
  const parsed = z.object({ sourceId: z.uuid(), generation: z.uuid() }).array().max(10_000).safeParse(input.members);
  if (!parsed.success) throw new ServiceError("conflict", "The original retention membership needs bounded explicit review.");
  const members = [...new Map(parsed.data.map(member => [`${member.sourceId}:${member.generation}`, member])).values()];
  await service.tx.execute(sql`select set_config('freeholder.retention_snapshot_v1','1',true)`);
  await service.tx.insert(privacyRetentionSourceSnapshots).values({ exceptionId: input.exceptionId, sourceScope: input.sourceScope, memberCount: members.length });
  for (let offset = 0; offset < members.length; offset += 500) {
    await service.tx.insert(privacyRetentionSourceMembers).values(members.slice(offset, offset + 500).map(member => ({ ...member, exceptionId: input.exceptionId, sourceScope: input.sourceScope })));
  }
}

/** An unknown cohort stops cleanup; it does not adopt a later generation. */
export async function hasUnknownRetentionSourceHold(tx: SnapshotReader, sourceScope: string, heldScopes: readonly string[]): Promise<boolean> {
  if (!heldScopes.length) return false;
  const [unknown] = await tx.select({ id: privacyRetentionExceptions.id }).from(privacyRetentionExceptions)
    .leftJoin(privacyRetentionSourceSnapshots, and(eq(privacyRetentionSourceSnapshots.exceptionId, privacyRetentionExceptions.id), eq(privacyRetentionSourceSnapshots.sourceScope, sourceScope)))
    .where(and(inArray(privacyRetentionExceptions.scope, [...heldScopes]), or(isNull(privacyRetentionExceptions.expiresAt), gt(privacyRetentionExceptions.expiresAt, sql`clock_timestamp()`)),
      or(isNull(privacyRetentionSourceSnapshots.exceptionId), ne(privacyRetentionSourceSnapshots.captureVersion, 1),
        sql`${privacyRetentionSourceSnapshots.memberCount}<>(select count(*)::integer from privacy_retention_source_members m where m.exception_id=${privacyRetentionSourceSnapshots.exceptionId} and m.source_scope=${privacyRetentionSourceSnapshots.sourceScope})`))).limit(1);
  return Boolean(unknown);
}

export async function retentionSourceMemberIsHeld(tx: SnapshotReader, sourceScope: string, sourceId: string, generation: string, heldScopes: readonly string[]): Promise<boolean> {
  if (!heldScopes.length) return false;
  const [member] = await tx.select({ id: privacyRetentionSourceMembers.exceptionId }).from(privacyRetentionSourceMembers)
    .innerJoin(privacyRetentionExceptions, eq(privacyRetentionExceptions.id, privacyRetentionSourceMembers.exceptionId))
    .where(and(eq(privacyRetentionSourceMembers.sourceScope, sourceScope), eq(privacyRetentionSourceMembers.sourceId, sourceId), eq(privacyRetentionSourceMembers.generation, generation),
      inArray(privacyRetentionExceptions.scope, [...heldScopes]), or(isNull(privacyRetentionExceptions.expiresAt), gt(privacyRetentionExceptions.expiresAt, sql`clock_timestamp()`)))).limit(1);
  return Boolean(member);
}
