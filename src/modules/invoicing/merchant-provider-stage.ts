// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// A positive automatic renewal must survive failure of its later invoice TX.
import type { PaymentProviderEvent } from "@/adapters/payments";
import { ServiceError } from "@/core/service";

type Retainer = (providerId: string, event: PaymentProviderEvent) => Promise<PaymentProviderEvent>;
let subscriptionRetainer: Retainer | undefined;

/** Trusted startup integration calls a committed shared-service phase. */
export function registerSubscriptionProviderEvidenceRetainer(retainer: Retainer): void { subscriptionRetainer = retainer; }

export async function retainSubscriptionProviderEvidence(providerId: string, event: PaymentProviderEvent): Promise<PaymentProviderEvent> {
  if (!["subscription_period_paid", "subscription_period_failed", "subscription_cancelled"].includes(event.kind)) return event;
  if (subscriptionRetainer) return subscriptionRetainer(providerId, event);
  if (event.providerPlatformAccountId) throw new ServiceError("conflict", "The original merchant subscription receipt phase is unavailable; retry authenticated feedback after recovery.");
  return event;
}
