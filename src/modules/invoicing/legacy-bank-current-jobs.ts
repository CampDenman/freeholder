// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C5.19/C12.38: committed signed feedback schedules read-only recovery.
import { z } from "zod";
import { defineJob } from "@/core/jobs";
import { recoverLegacyBankRefund } from "./legacy-bank-replacement-service";
export const reconcileOriginalLegacyRefundCurrentState = defineJob({
  name: "invoicing.reconcileOriginalLegacyRefundCurrentState",
  summary: "Read the authenticated exact original legacy refund after signed feedback without submitting a new refund or replacing a promise.",
  concurrency: 1, leaseSeconds: 300, retry: { limit: 40, delaySeconds: 30, backoff: true, maxDelaySeconds: 3600 },
  handler: async data => {
    const { refundId } = z.object({ refundId: z.uuid() }).strict().parse(data);
    const result = await recoverLegacyBankRefund.call({ refundId }, { kind: "system" });
    if (result.status === null || result.status === "pending" || result.status === "requires_action") throw Error("The original legacy refund still needs bank confirmation or customer action; retain its exact caller and refund promise debt.");
    return result;
  },
});
