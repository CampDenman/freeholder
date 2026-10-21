// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Typed HTTP client for a Freeholder instance (MASTER.md §28, C3.03).
//
// Concrete methods and input/output types are generated from the live
// service registry. Transport, auth and pagination wrappers live here and
// are typed against that generated layer so a contract change breaks them.
import { PLATFORM_VERSION } from "./version.ts";
import type {
  FreeholderApi,
  PageableService,
  ServiceCatalog,
  ServiceInput,
  ServiceName,
  ServiceOutput,
} from "./generated.ts";

export { PLATFORM_VERSION };
export {
  PAGEABLE_SERVICES,
  SERVICE_NAMES,
  type FreeholderApi,
  type PageableService,
  type ServiceCatalog,
  type ServiceInput,
  type ServiceName,
  type ServiceOutput,
} from "./generated.ts";

const SERVICE_NAME = /^[a-z][a-zA-Z0-9]*\.[a-zA-Z0-9]+$/;

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

type OptionalInputService = {
  [K in ServiceName]: Record<string, never> extends ServiceInput<K> ? K : never;
}[ServiceName];

type PageItem<K extends PageableService> = ServiceOutput<K> extends {
  rows: Array<infer Item>;
}
  ? Item
  : never;

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

  /** A client that presents a different API key on the same origin. */
  withToken(token: string): FreeholderClient {
    return new FreeholderClient({
      baseUrl: this.baseUrl,
      token,
      fetch: this.fetchImpl,
    });
  }

  /**
   * Namespaced methods for every service in the published catalog.
   * Instance-specific plugin verbs still go through `call(name, input)`.
   */
  get api(): FreeholderApi {
    return createApiProxy((name, input) => this.request(name, input));
  }

  async call<K extends OptionalInputService>(
    name: K,
    input?: ServiceInput<K>,
  ): Promise<ServiceOutput<K>>;
  async call<K extends ServiceName>(
    name: K,
    input: ServiceInput<K>,
  ): Promise<ServiceOutput<K>>;
  async call(name: string, input?: unknown): Promise<unknown>;
  async call(name: string, input: unknown = {}): Promise<unknown> {
    return this.request(name, input);
  }

  /**
   * Walk a `{ rows, total }` list until every row is yielded.
   * Only services in `PAGEABLE_SERVICES` accept this wrapper.
   */
  async *paginate<K extends PageableService>(
    name: K,
    input: Omit<ServiceInput<K>, "offset">,
  ): AsyncGenerator<PageItem<K>> {
    let offset = 0;
    for (;;) {
      const page = (await this.call(
        name,
        { ...(input as Record<string, unknown>), offset } as ServiceInput<K>,
      )) as { rows: PageItem<K>[]; total: number };
      for (const row of page.rows) yield row;
      offset += page.rows.length;
      if (page.rows.length === 0 || offset >= page.total) break;
    }
  }

  private async request(service: string, input: unknown = {}): Promise<unknown> {
    if (!SERVICE_NAME.test(service)) {
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
    return body;
  }
}

export function createClient(options: FreeholderClientOptions): FreeholderClient {
  return new FreeholderClient(options);
}

function createApiProxy(
  request: (name: string, input?: unknown) => Promise<unknown>,
): FreeholderApi {
  const families = new Map<string, object>();
  return new Proxy({} as FreeholderApi, {
    get(_target, family: string | symbol) {
      if (typeof family !== "string" || family === "then") return undefined;
      let methods = families.get(family);
      if (!methods) {
        methods = new Proxy(
          {},
          {
            get(_inner, verb: string | symbol) {
              if (typeof verb !== "string" || verb === "then") return undefined;
              return (input: unknown = {}) => request(`${family}.${verb}`, input);
            },
          },
        );
        families.set(family, methods);
      }
      return methods;
    },
  });
}
