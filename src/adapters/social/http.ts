// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Bounded HTTP for social providers (MASTER.md §12, C9.24).
import { AdapterError } from "../types";

const MAX_RESPONSE_BYTES = 256 * 1024;

export async function socialJson(
  response: Response,
  adapterId: string,
): Promise<unknown> {
  const raw = await response.text();
  if (raw.length > MAX_RESPONSE_BYTES) {
    throw new AdapterError(
      "social",
      adapterId,
      "provider_failure",
      "The provider returned an oversized response.",
      true,
    );
  }
  let parsed: unknown = {};
  if (raw) {
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      throw new AdapterError(
        "social",
        adapterId,
        "provider_failure",
        `The provider returned an unreadable response (HTTP ${response.status}).`,
        response.status >= 500,
      );
    }
  }
  if (!response.ok) {
    throw new AdapterError(
      "social",
      adapterId,
      response.status === 401 || response.status === 403
        ? "authentication"
        : "provider_failure",
      `The provider refused the request (HTTP ${response.status}).`,
      response.status === 429 || response.status >= 500,
    );
  }
  return parsed;
}

export async function socialBytes(
  response: Response,
  adapterId: string,
): Promise<Uint8Array<ArrayBuffer>> {
  if (!response.ok) {
    throw new AdapterError(
      "social",
      adapterId,
      "provider_failure",
      `The provider refused the media (HTTP ${response.status}).`,
      response.status >= 500,
    );
  }
  return new Uint8Array(await response.arrayBuffer());
}

export async function socialFetch(
  adapterId: string,
  input: string,
  init: RequestInit,
): Promise<Response> {
  try {
    return await fetch(input, {
      ...init,
      signal: init.signal ?? AbortSignal.timeout(30_000),
    });
  } catch (error) {
    if (error instanceof AdapterError) throw error;
    throw new AdapterError(
      "social",
      adapterId,
      "provider_failure",
      "The provider could not be reached.",
      true,
    );
  }
}
