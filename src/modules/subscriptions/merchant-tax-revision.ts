// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: a local pause cannot stop an independently running provider schedule.
import { z } from "zod";
import { defineService, ServiceError } from "@/core/service";
import { merchantTaxScheduleState } from "./merchant-tax-quiescence";

/** No status, missing reference, deadline or current configuration proves quiescence. */
export function assertNoExternalTaxDependencies(hasExternalAgreement: boolean): void {
  if (hasExternalAgreement) throw new ServiceError("conflict", "Reconcile and stop the original external subscription schedules before changing this merchant tax profile.");
}

// Invoicing registers this guard even when the optional subscriptions module is
// disabled. Original physical journals, current stop proof and actual financial
// reconciliation decide safety, including locally cancelled or paused rows.
export const assertMerchantTaxRevisionSafe = defineService({
  name: "subscriptions.assertMerchantTaxRevisionSafe",
  summary: "Refuse a tax revision while original external subscription schedules can still bill.",
  kind: "query",
  permission: "system",
  external: false,
  input: z.object({ profileId: z.uuid() }),
  output: z.object({ safe: z.literal(true) }),
  handler: async ({ profileId }, ctx) => {
    const state = await merchantTaxScheduleState(ctx, profileId);
    assertNoExternalTaxDependencies(!state.safe);
    return { safe: true as const };
  },
});
