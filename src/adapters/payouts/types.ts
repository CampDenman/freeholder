// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Marketplace payout providers (MASTER.md §44.8, C12.26–C12.27).
//
// A payout provider moves money the site already collected to a seller's
// own account with that provider: it sets the seller up (a hosted page or a
// short form), reports whether the seller can be paid, transfers each due
// payout, reverses one when the buyer is refunded (where the provider can),
// and turns its signed webhooks into account and transfer updates. The
// ledger in src/modules/members/payouts.ts decides what is owed and when;
// providers only carry it out.

export type PayoutAccountStatus = "pending" | "ready" | "disabled";

/** What a provider's setup form asks the seller for, beyond what the site knows. */
export type OnboardingField = "paypalEmail" | "legalName" | "phone" | "street" | "city" | "state" | "postalCode" | "beneficiaryName" | "accountNumber" | "ifsc";

export interface SellerIdentity {
  userId: string;
  email: string;
  displayName: string;
}

export interface OnboardingResult {
  /** The seller's account with the provider; stored, never shown to other people. */
  externalAccountId: string;
  /** Where to send the seller to finish setting up, for hosted onboarding. */
  url?: string;
  status: PayoutAccountStatus;
}

export interface TransferRequest {
  externalAccountId: string;
  amountMinor: number;
  currency: string;
  /**
   * The attempt's key: the ledger's payout id, then `<payout id>:<n>` for a
   * later attempt. The same key on a retry never pays twice, and it rides
   * on the transfer so a webhook names the attempt it belongs to.
   */
  idempotencyKey: string;
  description: string;
}

export interface TransferResult {
  reference: string;
  /** True when the money has moved; false when the provider confirms later by webhook. */
  settled: boolean;
}

export type ReverseResult = { reference: string } | { unsupported: string };

export type PayoutWebhookEvent =
  | { kind: "account"; externalAccountId: string; status: PayoutAccountStatus }
  /**
   * key is the attempt key the transfer carried, when the provider echoes it
   * back. "unclaimed": PayPal holds the money for the receiver to claim.
   */
  | { kind: "transfer"; reference: string; key?: string; state: "settled" | "failed" | "unclaimed"; error?: string };

export interface PayoutWebhookRequest {
  headers: Record<string, string | undefined>;
  body: Uint8Array;
  receivedAt: string;
}

export interface PayoutProvider {
  id: string;
  /** Missing configuration, by environment variable name; empty when ready. */
  missing(): string[];
  onboarding: { kind: "hosted" } | { kind: "form"; fields: readonly OnboardingField[] };
  onboard(seller: SellerIdentity, input: Partial<Record<OnboardingField, string>>, urls: { returnUrl: string; refreshUrl: string }, existing?: string | null): Promise<OnboardingResult>;
  accountStatus(externalAccountId: string): Promise<PayoutAccountStatus>;
  transfer(request: TransferRequest): Promise<TransferResult>;
  reverse(request: { reference: string; amountMinor: number; currency: string; idempotencyKey: string }): Promise<ReverseResult>;
  webhook(request: PayoutWebhookRequest): Promise<PayoutWebhookEvent[]>;
}
