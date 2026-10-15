// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// One bounded server-to-server request to Paradise Modern.
//
// Every caller here runs outside a service transaction (a job, an outbox
// listener, or the orchestration step before one), so a slow provider holds
// a worker, never a database connection.
import { paradiseSite } from "./config";

const MAX_RESPONSE_BYTES = 256 * 1024;

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;
let fetchOverride: FetchLike | undefined;

/** Tests only. Production always uses global fetch. */
export function setParadiseFetchForTests(next: FetchLike | undefined): void {
  fetchOverride = next;
}

export class ParadiseRequestError extends Error {
  constructor(
    message: string,
    /** 0 when PM was never reached. */
    readonly status: number,
    readonly retryable: boolean,
    /** PM's machine code (`EMAIL_CONSENT_REQUIRED`, `shield_not_enabled`…). */
    readonly code?: string,
  ) {
    super(message);
    this.name = "ParadiseRequestError";
  }
}

export interface ParadiseResponse<T> {
  status: number;
  body: T;
}

async function boundedJson(response: Response): Promise<unknown> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) return {};
  const raw = await response.text().catch(() => "");
  if (!raw || raw.length > MAX_RESPONSE_BYTES) return {};
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return {};
  }
}

function machineCode(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const record = body as Record<string, unknown>;
  const candidate = typeof record.code === "string"
    ? record.code
    : typeof record.error === "string"
      ? record.error
      : undefined;
  return candidate && /^[A-Za-z0-9_.:-]{1,80}$/.test(candidate) ? candidate : undefined;
}

/**
 * POST or GET JSON with the site key.
 *
 * Errors carry the status and PM's code, never the response body: a body can
 * echo the request, and the request carries a visitor's words.
 */
export async function paradiseRequest<T>(
  path: string,
  init: { method?: "GET" | "POST"; body?: unknown; timeoutMs?: number; headers?: Record<string, string> } = {},
): Promise<ParadiseResponse<T>> {
  const site = paradiseSite();
  if (!site.apiKey) {
    throw new ParadiseRequestError("PARADISEMODERN_API_KEY is not set.", 0, false, "not_configured");
  }
  let response: Response;
  try {
    response = await (fetchOverride ?? fetch)(`${site.baseUrl}${path}`, {
      method: init.method ?? "POST",
      headers: {
        accept: "application/json",
        ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
        "x-api-key": site.apiKey,
        ...init.headers,
      },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      signal: AbortSignal.timeout(init.timeoutMs ?? 15_000),
    });
  } catch {
    throw new ParadiseRequestError("Paradise Modern could not be reached.", 0, true, "unreachable");
  }
  const body = await boundedJson(response);
  if (!response.ok) {
    throw new ParadiseRequestError(
      `Paradise Modern refused the request (HTTP ${response.status}).`,
      response.status,
      response.status === 408 || response.status === 429 || response.status >= 500,
      machineCode(body),
    );
  }
  return { status: response.status, body: body as T };
}
