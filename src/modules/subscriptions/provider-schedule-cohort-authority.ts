// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38/C1.08: buyer erasure authority is not ownership of the merchant profile.
import { eq } from "drizzle-orm";
import { dataRequests } from "@/core/privacy/schema";
import { ServiceError, type Tx } from "@/core/service";
import { merchantTaxProfiles } from "@/modules/invoicing/merchant-tax-schema";
import { subscriptionProviderScheduleErasures } from "./provider-schedule-schema";
import { subscriptionMerchantScopes, subscriptions } from "./schema";

export type OriginalScheduleTask = { profileId: string; requestId: string; cohortId: string; originalJobId: string };
/** No artifact, local status, caller-supplied contact, or current merchant
 * account can grant another person's task its original schedule authority. */
export async function originalScheduleCohortAuthority(tx: Tx, input: OriginalScheduleTask, lock = false) {
  const requests = tx.select().from(dataRequests).where(eq(dataRequests.id, input.requestId)).limit(1);
  const cohorts = tx.select().from(subscriptionProviderScheduleErasures).where(eq(subscriptionProviderScheduleErasures.id, input.cohortId)).limit(1);
  const [request] = await (lock ? requests.for("update") : requests);
  const [cohort] = await (lock ? cohorts.for("update") : cohorts);
  if (!request || request.kind !== "erasure" || !request.verifiedAt || !cohort || cohort.profileId !== input.profileId
    || cohort.requestId !== input.requestId || cohort.jobId !== input.originalJobId || !cohort.jobIds.includes(input.originalJobId)) {
    throw new ServiceError("permission", "This schedule task is not a current member of its original verified erasure cohort.");
  }
  if (cohort.privacyScope === "commerce.merchantTax" && cohort.subscriptionId === null) {
    const [profile] = await tx.select().from(merchantTaxProfiles).where(eq(merchantTaxProfiles.id, input.profileId)).limit(1);
    if (!profile || profile.state !== "erased" && profile.contactId !== request.contactId) {
      throw new ServiceError("permission", "This merchant declaration is not owned by the original erasure subject.");
    }
  } else if (cohort.privacyScope === "subscriptions.agreements" && cohort.subscriptionId !== null) {
    const [original] = await tx.select({ parent: subscriptions, scope: subscriptionMerchantScopes }).from(subscriptions)
      .innerJoin(subscriptionMerchantScopes, eq(subscriptionMerchantScopes.subscriptionId, subscriptions.id))
      .where(eq(subscriptions.id, cohort.subscriptionId)).limit(1);
    if (!original || original.parent.contactId !== request.contactId || original.parent.merchantScopeVersion !== 1
      || original.scope.taxProfileId !== cohort.profileId || original.parent.billingMode !== "provider") {
      throw new ServiceError("permission", "This agreement is not owned by the original erasure subject and merchant scope.");
    }
  } else throw new ServiceError("permission", "Restore the exact original schedule privacy scope before running its task.");
  return { request, cohort };
}
