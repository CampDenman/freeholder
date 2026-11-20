// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38/C1.08: a restored queue row cannot invent an empty buyer inventory.
import { z } from "zod";
import { merchantTaxDigest } from "./merchant-tax-store";
export const buyerMoneyErasurePayload = z.object({ requestId: z.uuid(), originalJobId: z.uuid(), originalAgreementIds: z.array(z.uuid()).max(5000), originalPaymentIds: z.array(z.uuid()).max(5000) }).strict();
export function originalBuyerMoneyInventory(data: unknown, payloadHash: string | undefined, expected: { requestId: string; originalJobId: string }): z.infer<typeof buyerMoneyErasurePayload> | null {
  const parsed = buyerMoneyErasurePayload.safeParse(data);
  if (!payloadHash || !parsed.success || parsed.data.requestId !== expected.requestId || parsed.data.originalJobId !== expected.originalJobId
    || merchantTaxDigest(parsed.data) !== payloadHash || new Set(parsed.data.originalAgreementIds).size !== parsed.data.originalAgreementIds.length
    || new Set(parsed.data.originalPaymentIds).size !== parsed.data.originalPaymentIds.length
    || parsed.data.originalAgreementIds.length + parsed.data.originalPaymentIds.length > 5000) return null;
  return parsed.data;
}
