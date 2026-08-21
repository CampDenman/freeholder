// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Bounded provider responses: an upstream must not get an unbounded allocation.
import { MailAdapterError } from "@/adapters/mail/types";

const MAX_RESPONSE_BYTES = 256 * 1024;

export async function boundedText(response: Response): Promise<string> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    throw new MailAdapterError("The provider returned an oversized response.");
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let body = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new MailAdapterError("The provider returned an oversized response.");
    }
    body += decoder.decode(value, { stream: true });
  }
  return body + decoder.decode();
}

export async function providerJson<T>(
  response: Response,
  provider: string,
): Promise<T> {
  const raw = await boundedText(response);
  let parsed: unknown = {};
  if (raw) {
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      throw new MailAdapterError(
        `${provider} returned an unreadable response (HTTP ${response.status}).`,
        response.status >= 500,
        response.status,
      );
    }
  }
  if (!response.ok) {
    const record =
      parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
    const rawCode = typeof record.error === "string" ? record.error : undefined;
    const providerCode =
      rawCode && /^[A-Za-z0-9_.-]{1,80}$/.test(rawCode) ? rawCode : undefined;
    throw new MailAdapterError(
      `${provider} refused the request (HTTP ${response.status}).`,
      response.status === 408 || response.status === 429 || response.status >= 500,
      response.status,
      providerCode,
    );
  }
  return parsed as T;
}

/** A provider label safe for an operator-facing status/detail object. */
export function safeProviderLabel(
  value: unknown,
  fallback = "unknown",
): string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9 ._:/-]{0,79}$/.test(value)
    ? value
    : fallback;
}

export async function requestWithTimeout(
  fetcher: typeof globalThis.fetch,
  input: string | URL | Request,
  init: RequestInit,
): Promise<Response> {
  try {
    return await fetcher(input, {
      ...init,
      signal: init.signal ?? AbortSignal.timeout(30_000),
    });
  } catch (error) {
    if (error instanceof MailAdapterError) throw error;
    throw new MailAdapterError("The mail provider could not be reached.", true);
  }
}
