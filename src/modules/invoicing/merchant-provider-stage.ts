// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// A positive automatic renewal must survive failure of its later invoice TX.
import type { MerchantScheduleLocator, PaymentProviderEvent } from "@/adapters/payments";
import { ServiceError } from "@/core/service";

type Retainer = (providerId: string, event: PaymentProviderEvent) => Promise<PaymentProviderEvent>;
let subscriptionRetainer: Retainer | undefined;

export interface SubscriptionProviderScopeInput {
  providerSubscriptionRef: string;
  providerInvoiceRef?: string;
  providerAccountId?: string;
  metadata: Record<string, unknown>;
}
export interface SubscriptionProviderWebhookScope extends MerchantScheduleLocator {
  providerScheduleOperationId?: string;
  providerCustomerRef?: string;
}
type ScopeResolver = (providerId: string, input: SubscriptionProviderScopeInput) => Promise<SubscriptionProviderWebhookScope | null>;
let subscriptionScopeResolver: ScopeResolver | undefined;

/** Called by an adapter only after authenticating the exact raw event bytes. */
export function registerSubscriptionProviderScopeResolver(resolver: ScopeResolver): void { subscriptionScopeResolver = resolver; }

export async function resolveSubscriptionProviderScope(providerId: string, input: SubscriptionProviderScopeInput): Promise<SubscriptionProviderWebhookScope | null> {
  if (subscriptionScopeResolver) return subscriptionScopeResolver(providerId, input);
  // An admitted new schedule must never fall back to an older protocol if its
  // source integration is unavailable. Unmarked legacy feedback stays intact.
  if (input.metadata.freeholder_subscription_scope_version === "1" || input.metadata.freeholder_subscription_operation_id !== undefined) throw new ServiceError("conflict", "The original merchant subscription scope phase is unavailable; retry authenticated feedback after recovery.");
  return null;
}

/** Trusted startup integration calls a committed shared-service phase. */
export function registerSubscriptionProviderEvidenceRetainer(retainer: Retainer): void { subscriptionRetainer = retainer; }

export async function retainSubscriptionProviderEvidence(providerId: string, event: PaymentProviderEvent): Promise<PaymentProviderEvent> {
  if (!["subscription_period_paid", "subscription_period_failed", "subscription_cancelled"].includes(event.kind)) return event;
  if (subscriptionRetainer) return subscriptionRetainer(providerId, event);
  if (event.providerPlatformAccountId) throw new ServiceError("conflict", "The original merchant subscription receipt phase is unavailable; retry authenticated feedback after recovery.");
  return event;
}
