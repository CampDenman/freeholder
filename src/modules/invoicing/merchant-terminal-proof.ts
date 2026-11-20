// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: an original saved-card intent has no invented Checkout Session.
import { z } from "zod";

export const merchantCheckoutReference = z.string().regex(/^cs_[A-Za-z0-9_]+$/).max(200);
export const merchantIntentReference = z.string().regex(/^pi_[A-Za-z0-9_]+$/).max(200);
export const merchantTerminalProof = z.object({
  checkoutRef: merchantCheckoutReference.nullable().optional(),
  paymentRef: merchantIntentReference.nullable().optional(),
  sessionStatus: z.enum(["expired", "complete"]).nullable().optional(),
  intentStatus: z.string().nullable(),
  amountReceivedMinor: z.literal(0),
}).refine(value => {
  if (!value.checkoutRef) return !value.sessionStatus && Boolean(value.paymentRef) && value.intentStatus === "canceled";
  if (value.sessionStatus === "expired") return !value.paymentRef && value.intentStatus === null
    || Boolean(value.paymentRef && ["canceled", "requires_payment_method", "requires_confirmation", "requires_action"].includes(value.intentStatus ?? ""));
  return value.sessionStatus === "complete" && Boolean(value.paymentRef) && value.intentStatus === "canceled";
}, "The provider must prove this exact original resource can no longer collect money.");
