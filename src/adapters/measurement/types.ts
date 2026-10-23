// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The measurement adapter contract (C3.32, MASTER.md §12).

/** One accepted enquiry from a visitor who explicitly allowed measurement. */
export interface LeadConversion {
  /** Freeholder's submission id: the provider's deduplication key. */
  submissionId: string;
  email?: string;
  phone?: string;
  ip?: string;
  userAgent?: string;
  sourceUrl?: string;
  clickIds: Record<string, string>;
}

export interface MeasurementAdapter {
  readonly id: "paradise";
  /** Named to visitors in the consent choice. */
  readonly displayName: string;
  /** Browser scripts, rendered nonced only for a visitor who allowed them. */
  scriptSources(): string[];
  /** The provider's first-party click-ID cookie, if it keeps one. */
  readonly clickIdCookie?: string;
  clickIds(raw: string | undefined): Record<string, string>;
  /** Provider I/O: never inside a service transaction. */
  recordConversion(event: LeadConversion): Promise<void>;
}
