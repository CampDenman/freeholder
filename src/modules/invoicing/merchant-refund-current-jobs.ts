// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { z } from "zod";
import { defineJob } from "@/core/jobs";
import { reconcileOriginalMerchantRefundCurrentState } from "./merchant-refund-current-service";

export const reconcileOriginalRefundCurrentState = defineJob({
  name: "invoicing.reconcileOriginalRefundCurrentState",
  summary: "Read the exact original refund after committed bank feedback without another customer-money request.",
  concurrency: 1, leaseSeconds: 300,
  retry: { limit: 40, delaySeconds: 30, backoff: true, maxDelaySeconds: 3600 },
  handler: async data => {
    const { requestId } = z.object({ requestId: z.uuid() }).parse(data);
    const current = await reconcileOriginalMerchantRefundCurrentState(requestId, { kind: "system" });
    if (!current.terminal || current.status === null) throw new Error("The original refund still needs action or confirmation; its cash reservation and customer credit remain visible.");
    return { receiptId: current.receiptId, status: current.status, applied: current.applied, requiresReview: current.requiresReview };
  },
});
