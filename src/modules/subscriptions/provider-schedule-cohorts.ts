// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38/C1.08: a partial restore cannot turn missing agreements into no history.
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { jobIdempotencyKeys } from "@/core/jobs/schema";
import type { Tx } from "@/core/service";
import { merchantTaxDigest } from "@/modules/invoicing/merchant-tax-store";
import type { subscriptionProviderScheduleErasures } from "./provider-schedule-schema";

export const originalMerchantScheduleJob = z.object({ profileId: z.uuid(), requestId: z.uuid(), originalJobId: z.uuid(), cohortId: z.uuid(),
  originalAgreementIds: z.array(z.uuid()).max(5000) }).strict();
type Cohort = Pick<typeof subscriptionProviderScheduleErasures.$inferSelect, "id" | "profileId" | "requestId" | "originalJobId">;

/** The ordinary queue payload is not an absence proof by itself. Its durable
 * original enqueue hash must agree, and every original child must still exist. */
export function originalMerchantScheduleInventoryCovers(cohort: Cohort, retained: unknown, payloadHash: string | undefined, currentAgreementIds: ReadonlySet<string>): boolean {
  const parsed = originalMerchantScheduleJob.safeParse(retained);
  if (!parsed.success || !payloadHash || merchantTaxDigest(parsed.data) !== payloadHash) return false;
  const source = parsed.data;
  return source.cohortId === cohort.id && source.profileId === cohort.profileId && source.requestId === cohort.requestId && source.originalJobId === cohort.originalJobId
    && new Set(source.originalAgreementIds).size === source.originalAgreementIds.length
    && source.originalAgreementIds.every(id => currentAgreementIds.has(id));
}

export async function merchantScheduleCohortInventoryCovers(tx: Tx, cohort: Cohort, currentAgreementIds: ReadonlySet<string>): Promise<boolean> {
  const [claim] = await tx.select({ payloadHash: jobIdempotencyKeys.payloadHash }).from(jobIdempotencyKeys)
    .where(and(eq(jobIdempotencyKeys.jobName, "subscriptions.quiesceMerchantSchedules"), eq(jobIdempotencyKeys.jobId, cohort.originalJobId))).limit(1);
  if (!claim) return false;
  const [job] = await tx.execute<{ data: unknown }>(sql`select data from pgboss.job where id=${cohort.originalJobId}::uuid and name='subscriptions.quiesceMerchantSchedules' limit 1`);
  return originalMerchantScheduleInventoryCovers(cohort, job?.data, claim.payloadHash, currentAgreementIds);
}
