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

export interface LeadSinkAdapter {
  readonly id: Exclude<LeadSinkProviderId, "none">;
  /** Named in the privacy notice beside the form. */
  readonly displayName: string;
  /**
   * Provider I/O — outbox listeners only. Throws on any failure, with a
   * message that carries no answer from the lead; the outbox retries and
   * finally dead-letters the delivery for the owner to replay.
   */
  send(lead: LeadCopy): Promise<void>;
}
