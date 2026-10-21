// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Bounded HTTP for social providers (MASTER.md §12, C9.24).
import { AdapterError } from "../types";

const MAX_RESPONSE_BYTES = 256 * 1024;

async function boundedBody(
  response: Response,
  adapterId: string,
): Promise<Uint8Array<ArrayBuffer>> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    throw new AdapterError(
      "social",
      adapterId,
      "provider_failure",
      "The provider returned an oversized response.",
      true,
    );
  }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let received = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      received += part.value.byteLength;
      if (received > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new AdapterError(
          "social",
          adapterId,
          "provider_failure",
          "The provider returned an oversized response.",
          true,
        );
      }
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

export async function socialJson(
  response: Response,
  adapterId: string,
): Promise<unknown> {
  const raw = new TextDecoder().decode(await boundedBody(response, adapterId));
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

export async function socialFetch(
  adapterId: string,
  input: string,
  init: RequestInit,
): Promise<Response> {
  try {
    return await fetch(input, {
      ...init,
      redirect: init.redirect ?? "error",
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
