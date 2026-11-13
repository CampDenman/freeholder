// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C5.19/C12.38: read, prove and project through the same actual money services.
import { z } from "zod";
import { defineOrchestratedService } from "@/core/service";
import { inspectLegacyBankRefund } from "./legacy-bank-read-service";
import { completeLegacyBankCurrentRead } from "./legacy-bank-current-state";
import { applyLegacyCurrentRefundState } from "./invoice-service";

export const reconcileLegacyBankRefund = defineOrchestratedService({
  name: "invoicing.reconcileLegacyBankRefund", summary: "Reconcile the exact authentic legacy refund bank resource without creating a new refund, payment or credit.",
  kind: "mutation", permission: "scoped", stepUp: true, external: false, writeClass: "money", auditInputFields: ["refundId"],
  input: z.object({ refundId: z.uuid() }).strict(),
  output: z.object({ receiptId: z.uuid(), status: z.enum(["pending", "requires_action", "succeeded", "failed", "canceled"]).nullable(), applied: z.boolean(), requiresReview: z.boolean() }),
  handler: async (input, caller) => {
    const read = await inspectLegacyBankRefund.call(input, caller), actor = { kind: "system", request: caller.request } as const;
    const proof = await completeLegacyBankCurrentRead.call({ readId: read.readId }, actor);
    const projection = await applyLegacyCurrentRefundState.call({ receiptId: proof.receiptId }, actor);
    return { ...proof, applied: projection.applied, requiresReview: proof.requiresReview || projection.requiresReview };
  },
});
export default [completeLegacyBankCurrentRead, reconcileLegacyBankRefund];
