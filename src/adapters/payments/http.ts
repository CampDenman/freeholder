// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Bounded, credential-safe HTTP helpers shared by payment providers.

import { AdapterError } from "../types";

const MAX_RESPONSE_BYTES = 1_048_576;

export async function providerJson(
  adapterId: string,
  response: Response,
): Promise<Record<string, unknown>> {
  const body = await response.text();
  if (body.length > MAX_RESPONSE_BYTES) {
    throw new AdapterError("payments", adapterId, "provider_failure", "The payment provider returned an oversized response.", true);
  }
  let parsed: unknown;
  try {
    parsed = body ? JSON.parse(body) : {};
  } catch {
    throw new AdapterError("payments", adapterId, "provider_failure", "The payment provider returned an unreadable response.", response.status >= 500);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new AdapterError("payments", adapterId, "provider_failure", "The payment provider returned an invalid response.", response.status >= 500);
  }
  if (!response.ok) {
    const record = parsed as Record<string, unknown>;
    const nested = record.error && typeof record.error === "object"
      ? record.error as Record<string, unknown>
      : undefined;
    const candidate = nested?.code ?? nested?.type ?? record.name;
    const code = (typeof candidate === "string" || typeof candidate === "number"
      ? String(candidate)
      : "provider_error").slice(0, 100);
    const retryable = response.status === 429 || response.status >= 500;
    throw new AdapterError(
      "payments",
      adapterId,
      response.status === 401 || response.status === 403
        ? "authentication"
        : response.status === 429
          ? "rate_limited"
          : response.status >= 500
            ? "provider_failure"
            : "invalid_request",
      `The payment provider refused the request (${code}).`,
      retryable,
    );
  }
  return parsed as Record<string, unknown>;
}

export function paymentFetch(fetcher: typeof fetch, input: string, init: RequestInit): Promise<Response> {
  return fetcher(input, {
    ...init,
    signal: init.signal ?? AbortSignal.timeout(20_000),
  }).catch((error: unknown) => {
    if (error instanceof AdapterError) throw error;
    throw new AdapterError("payments", "network", "provider_failure", "The payment provider could not be reached.", true);
  });
}

export function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

export function text(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function number(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : undefined;
}
