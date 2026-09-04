// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Generated-from-registry client (MASTER.md §28, C3.03).
//
// The method list is the instance's live service registry: this package
// does not invent endpoints. `call(name, input)` POSTs `/api/v1/<name>`
// with the same JSON the OpenAPI document describes.
import { PLATFORM_VERSION } from "./version.ts";

export { PLATFORM_VERSION };

export class FreeholderError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "FreeholderError";
  }
}

export interface FreeholderClientOptions {
  /** Instance origin, no trailing slash. */
  baseUrl: string;
  /** API key from Settings. Omit for public services. */
  token?: string;
  fetch?: typeof fetch;
}

export class FreeholderClient {
  readonly version = PLATFORM_VERSION;
  private readonly baseUrl: string;
  private readonly token?: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: FreeholderClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.token = options.token;
    this.fetchImpl = options.fetch ?? fetch;
  }

  async call<T = unknown>(service: string, input: unknown = {}): Promise<T> {
    if (!/^[a-z][a-zA-Z0-9]*\.[a-zA-Z0-9]+$/.test(service)) {
      throw new FreeholderError(400, "validation", `Not a service name: ${service}`);
    }
    const headers: Record<string, string> = {
      accept: "application/json",
      "content-type": "application/json",
    };
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    const response = await this.fetchImpl(`${this.baseUrl}/api/v1/${service}`, {
      method: "POST",
      headers,
      body: JSON.stringify(input ?? {}),
    });
    const body = (await response.json().catch(() => ({}))) as {
      error?: { code?: string; message?: string };
    };
    if (!response.ok) {
      throw new FreeholderError(
        response.status,
        body.error?.code ?? "internal",
        body.error?.message ?? `HTTP ${response.status}`,
      );
    }
    return body as T;
  }
}

export function createClient(options: FreeholderClientOptions): FreeholderClient {
  return new FreeholderClient(options);
}
