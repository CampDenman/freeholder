// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// One bounded server-to-server request to Paradise Modern (C3.31–C3.34).
//
// Every caller runs outside a service transaction — a job, an outbox
// listener, or the orchestration step before one — so a slow provider holds
// a worker, never a database connection. `tests/core/long-running-service-
// boundary.test.ts` lists `paradiseRequest` as provider I/O and fails a
// handler that calls it inside a transaction.
//
// The site key is a credential, so it travels only to the configured origin:
// the base must be HTTPS (plain HTTP only on a loopback host, for tests and
// local development), the path cannot name another host, and redirects are
// refused rather than followed — a redirect would carry `x-api-key` to
// wherever it pointed. A public playground never calls out at all.
import { env } from "@/core/env";
import { playgroundBlocksExternalDelivery } from "@/core/demo/playground-policy";
import { paradiseSite } from "./config";

const MAX_RESPONSE_BYTES = 256 * 1024;
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;
let fetchOverride: FetchLike | undefined;

/** Tests only. Production always uses global fetch. */
export function setParadiseFetchForTests(next: FetchLike | undefined): void {
  fetchOverride = next;
}

export class ParadiseRequestError extends Error {
  constructor(
    message: string,
    /** 0 when Paradise was never reached. */
    readonly status: number,
    readonly retryable: boolean,
    /** Paradise's machine code (`EMAIL_CONSENT_REQUIRED`…) or a local one. */
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

/**
 * The absolute URL for one API path, or a refusal.
 *
 * Exported for tests: the rule is the point, and it is easier to read here
 * than through a mocked fetch.
 */
export function paradiseUrl(baseUrl: string, path: string): string {
  if (!/^\/[A-Za-z0-9/_.~%-]*$/.test(path) || path.startsWith("//")) {
    throw new ParadiseRequestError("That is not a Paradise Modern API path.", 0, false, "invalid_path");
  }
  let base: URL;
  try {
    base = new URL(baseUrl);
  } catch {
    throw new ParadiseRequestError("PARADISEMODERN_URL is not a URL.", 0, false, "insecure_url");
  }
  const secure =
    base.protocol === "https:" || (base.protocol === "http:" && LOOPBACK_HOSTS.has(base.hostname));
  if (!secure || base.username || base.password || base.search || base.hash) {
    throw new ParadiseRequestError(
      "PARADISEMODERN_URL must be an https:// address; the site key is never sent in clear text.",
      0,
      false,
      "insecure_url",
    );
  }
  const target = new URL(`${baseUrl.replace(/\/+$/, "")}${path}`);
  if (target.origin !== base.origin) {
    throw new ParadiseRequestError("That is not a Paradise Modern API path.", 0, false, "invalid_path");
  }
  return target.href;
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
 * Errors carry the status and Paradise's code, never the response body: a
 * body can echo the request, and the request can carry a visitor's words.
 */
export async function paradiseRequest<T>(
  path: string,
  init: { method?: "GET" | "POST"; body?: unknown; timeoutMs?: number } = {},
): Promise<ParadiseResponse<T>> {
  if (playgroundBlocksExternalDelivery(env())) {
    // Matches mail, SMS and webhooks: a public playground fails closed.
    throw new ParadiseRequestError(
      "The public playground never contacts outside providers.",
      0,
      false,
      "playground",
    );
  }
  const site = paradiseSite();
  if (!site.apiKey) {
    throw new ParadiseRequestError("PARADISEMODERN_API_KEY is not set.", 0, false, "not_configured");
  }
  const url = paradiseUrl(site.baseUrl, path);
  let response: Response;
  try {
    response = await (fetchOverride ?? fetch)(url, {
      method: init.method ?? "POST",
      headers: {
        accept: "application/json",
        ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
        "x-api-key": site.apiKey,
      },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      redirect: "error",
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
