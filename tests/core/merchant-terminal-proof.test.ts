// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { merchantTerminalProof } from "@/modules/invoicing/merchant-terminal-proof";

describe("exact original no-money terminal evidence", () => {
  it.each([
    { paymentRef: "pi_original", intentStatus: "canceled", amountReceivedMinor: 0 },
    { checkoutRef: null, sessionStatus: null, paymentRef: "pi_original", intentStatus: "canceled", amountReceivedMinor: 0 },
    { checkoutRef: "cs_original", sessionStatus: "expired", intentStatus: null, amountReceivedMinor: 0 },
    { checkoutRef: "cs_original", sessionStatus: "expired", paymentRef: "pi_original", intentStatus: "requires_action", amountReceivedMinor: 0 },
    { checkoutRef: "cs_original", sessionStatus: "complete", paymentRef: "pi_original", intentStatus: "canceled", amountReceivedMinor: 0 },
  ])("accepts actual provider terminal proof %#", proof => expect(merchantTerminalProof.safeParse(proof).success).toBe(true));
  it.each([
    { paymentRef: "pi_original", intentStatus: "processing", amountReceivedMinor: 0 },
    { paymentRef: "pi_original", intentStatus: "requires_payment_method", amountReceivedMinor: 0 },
    { paymentRef: "pi_original", intentStatus: "canceled", amountReceivedMinor: 1 },
    { paymentRef: "pi_original", intentStatus: "canceled", amountReceivedMinor: 0, sessionStatus: "expired" },
    { checkoutRef: "cs_original", intentStatus: "canceled", paymentRef: "pi_original", amountReceivedMinor: 0 },
    { checkoutRef: "cs_original", sessionStatus: "expired", intentStatus: "processing", paymentRef: "pi_original", amountReceivedMinor: 0 },
    { checkoutRef: "cs_original", sessionStatus: "complete", intentStatus: null, amountReceivedMinor: 0 },
    { checkoutRef: null, sessionStatus: null, paymentRef: null, intentStatus: null, amountReceivedMinor: 0 },
  ])("refuses pending, positive, missing or mismatched resource evidence %#", proof => expect(merchantTerminalProof.safeParse(proof).success).toBe(false));
});
