// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// One provider vocabulary shared by config, services, routes, and admin.

export const HOSTED_PAYMENT_PROVIDER_IDS = [
  "stripe",
  "paypal",
  "square",
  "mollie",
  "razorpay",
  "paystack",
  "flutterwave",
] as const;

export const LEDGER_PAYMENT_PROVIDER_IDS = [
  "manual",
  "balance",
  ...HOSTED_PAYMENT_PROVIDER_IDS,
] as const;

export const CONFIGURABLE_PAYMENT_PROVIDER_IDS = [
  "manual",
  ...HOSTED_PAYMENT_PROVIDER_IDS,
] as const;

export type HostedPaymentProviderId = (typeof HOSTED_PAYMENT_PROVIDER_IDS)[number];
export type LedgerPaymentProviderId = (typeof LEDGER_PAYMENT_PROVIDER_IDS)[number];

export function isHostedPaymentProvider(value: string): value is HostedPaymentProviderId {
  return (HOSTED_PAYMENT_PROVIDER_IDS as readonly string[]).includes(value);
}
