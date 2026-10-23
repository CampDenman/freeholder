// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The lead-sink adapter contract (C3.34, MASTER.md §12).

export const LEAD_SINK_PROVIDERS = ["none", "paradise"] as const;
export type LeadSinkProviderId = (typeof LEAD_SINK_PROVIDERS)[number];

/** One accepted submission, as copied. The privacy notice lists these fields. */
export interface LeadCopy {
  /** Freeholder's submission id, so the copy points back at the original. */
  submissionId: string;
  formSlug: string;
  name: string;
  email?: string;
  phone?: string;
  message?: string;
  /** Every non-empty answer, keyed by the field's label. */
  answers: Record<string, unknown>;
  /** The absolute page address the form was sent from. */
  pageUrl?: string;
}

/** A refusal the outbox should retry (the provider was down or busy). */
export class LeadSinkRetryableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LeadSinkRetryableError";
  }
}

export interface LeadSinkAdapter {
  readonly id: Exclude<LeadSinkProviderId, "none">;
  /** Named in the privacy notice beside the form. */
  readonly displayName: string;
  /**
   * Provider I/O — outbox listeners only. Throws `LeadSinkRetryableError`
   * for a transient failure; any other throw is a permanent refusal.
   */
  send(lead: LeadCopy): Promise<void>;
}
