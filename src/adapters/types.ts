// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Shared vendor-edge vocabulary (MASTER.md §12, C5.01).

export type AdapterFamily =
  | "payments"
  | "tax"
  | "calendar"
  | "sms"
  | "bulk_mail"
  | "ai"
  | "social"
  | "carrier"
  | "point_of_sale";

export interface AdapterStatus {
  family: AdapterFamily;
  id: string;
  available: boolean;
  message: string;
}

export interface RawProviderRequest {
  /** Lower-cased header names. The HTTP boundary owns canonicalization. */
  headers: Readonly<Record<string, string>>;
  /** Exact bytes used for signature verification; never decoded first. */
  body: Uint8Array<ArrayBuffer>;
  receivedAt: string;
}

export type AdapterErrorCode =
  | "unavailable"
  | "invalid_request"
  | "authentication"
  | "rate_limited"
  | "provider_failure";

/** Safe provider-edge failure. It must never contain credentials or raw bodies. */
export class AdapterError extends Error {
  constructor(
    readonly family: AdapterFamily,
    readonly adapterId: string,
    readonly code: AdapterErrorCode,
    message: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "AdapterError";
  }
}

export function unavailable(
  family: AdapterFamily,
  adapterId: string,
  message: string,
): AdapterError {
  return new AdapterError(family, adapterId, "unavailable", message, false);
}
