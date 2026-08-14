// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Exact-byte authentication and defensive parsing shared by hosted providers.

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { AdapterError } from "../types";

export function parseProviderJson(provider: string, body: Uint8Array): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(body).toString("utf8"));
  } catch {
    throw new AdapterError("payments", provider, "invalid_request", `${provider} sent invalid JSON.`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new AdapterError("payments", provider, "invalid_request", `${provider} sent an invalid event.`);
  }
  return parsed as Record<string, unknown>;
}

export function providerIdentifier(value: unknown): string | undefined {
  if (typeof value === "string" && value.length > 0) return value;
  if (typeof value === "number" && Number.isSafeInteger(value)) return String(value);
  return undefined;
}

export function providerTime(provider: string, value: unknown, fallback?: string): string {
  const date = typeof value === "number" && Number.isFinite(value)
    ? new Date(value > 10_000_000_000 ? value : value * 1_000)
    : typeof value === "string"
      ? new Date(value)
      : fallback
        ? new Date(fallback)
        : new Date(Number.NaN);
  if (!Number.isFinite(date.valueOf())) {
    throw new AdapterError("payments", provider, "invalid_request", `${provider} sent an invalid event time.`);
  }
  return date.toISOString();
}

export function deterministicProviderRef(prefix: string, value: string, maxLength = 40): string {
  const digest = createHash("sha256").update(value, "utf8").digest("hex");
  return `${prefix}${digest}`.slice(0, maxLength);
}

export function bodyEventId(provider: string, body: Uint8Array, suffix = "event"): string {
  return `${provider}:${suffix}:${createHash("sha256").update(body).digest("hex")}`;
}

function decodeSignature(value: string, encoding: "hex" | "base64"): Buffer | undefined {
  if (encoding === "hex" && !/^[0-9a-f]+$/i.test(value)) return undefined;
  try {
    const decoded = Buffer.from(value, encoding);
    return decoded.length > 0 ? decoded : undefined;
  } catch {
    return undefined;
  }
}

export function verifyProviderHmac(input: {
  provider: string;
  algorithm: "sha256" | "sha512";
  secrets: readonly string[];
  signed: Uint8Array | Buffer;
  signature?: string;
  encoding: "hex" | "base64";
  prefix?: string;
}): void {
  const received = input.signature?.trim();
  if (!received) {
    throw new AdapterError("payments", input.provider, "authentication", `${input.provider} signature is missing.`);
  }
  const signature = input.prefix && received.startsWith(input.prefix)
    ? received.slice(input.prefix.length)
    : received;
  const actual = decodeSignature(signature, input.encoding);
  const valid = actual && input.secrets.some((secret) => {
    const expected = createHmac(input.algorithm, secret).update(input.signed).digest();
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  });
  if (!valid) {
    throw new AdapterError("payments", input.provider, "authentication", `${input.provider} signature is invalid.`);
  }
}

export function unsupportedSavedMethod(provider: string): never {
  throw new AdapterError(
    "payments",
    provider,
    "unavailable",
    `${provider} saved-payment-method revocation is not implemented; no reusable method is stored by this adapter.`,
  );
}
