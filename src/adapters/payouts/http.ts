// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.26–C12.27: reading a payout provider's reply.
import { AdapterError } from "../types";
import { providerJson } from "../payments/http";

/**
 * As providerJson, except that 409 Conflict is not a refusal. Stripe,
 * Razorpay and PayPal answer 409 while a request with the same idempotency
 * key is still being processed: the money may be moving, so the attempt's
 * outcome is unknown and the same key is retried later.
 */
export async function payoutJson(adapterId: string, response: Response): Promise<Record<string, unknown>> {
  if (response.status === 409) {
    await response.body?.cancel().catch(() => undefined);
    throw new AdapterError("payments", adapterId, "provider_failure", "The payout provider is still processing an earlier request with the same key.", true);
  }
  return providerJson(adapterId, response);
}
