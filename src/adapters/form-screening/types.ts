// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The form-screening adapter contract (C3.33, MASTER.md §12, §36).

export const FORM_SCREENING_PROVIDERS = ["none", "paradise"] as const;
export type FormScreeningProviderId = (typeof FORM_SCREENING_PROVIDERS)[number];

/** What one submission's screening concluded. */
export type ScreeningOutcome = "allow" | "blocked" | "unavailable";

/** Exactly what an adapter receives, which is also what it may send. */
export interface ScreeningRequest {
  /** A stable reference to the form, never its answers. */
  formRef: string;
  /** The visitor's address, as the request metadata resolved it. */
  clientIp: string;
  /** The words being screened: the submission's longest prose answer. */
  message: string;
}

export interface FormScreeningAdapter {
  readonly id: Exclude<FormScreeningProviderId, "none">;
  /** Named in the privacy notice beside the form. */
  readonly displayName: string;
  /** What the notice lists as sent, as locale keys of `forms.public.sent.*`. */
  readonly sends: readonly ("formRef" | "clientIp" | "message")[];
  /**
   * Provider I/O — never inside a service transaction. Never throws: an
   * unreachable, slow or refusing provider answers "unavailable", which is
   * no evidence about the visitor either way.
   */
  assess(request: ScreeningRequest): Promise<ScreeningOutcome>;
}
