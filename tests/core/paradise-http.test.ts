// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The one HTTP path to Paradise Modern as an optional provider (C3.31–C3.34):
// its site key reaches only the configured HTTPS origin, never follows a
// redirect, and a public playground never calls out at all.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ParadiseRequestError,
  paradiseRequest,
  paradiseUrl,
  setParadiseFetchForTests,
} from "@/adapters/paradise/http";
import { paradiseBaseUrl } from "@/adapters/paradise/config";
import { env, resetEnvForTests } from "@/core/env";

const NAMES = ["PARADISEMODERN_API_KEY", "PARADISEMODERN_URL", "FREEHOLDER_PLAYGROUND"] as const;
const prior = Object.fromEntries(NAMES.map((name) => [name, process.env[name]]));
let calls: Array<{ url: string; init: RequestInit }> = [];

beforeEach(() => {
  for (const name of NAMES) delete process.env[name];
  process.env.PARADISEMODERN_API_KEY = "site-key";
  resetEnvForTests();
  calls = [];
  setParadiseFetchForTests(async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  });
});

afterEach(() => {
  setParadiseFetchForTests(undefined);
  for (const name of NAMES) {
    if (prior[name] === undefined) delete process.env[name];
    else process.env[name] = prior[name];
  }
  resetEnvForTests();
});

async function refusal(promise: Promise<unknown>): Promise<ParadiseRequestError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ParadiseRequestError) return error;
    throw error;
  }
  throw new Error("expected a refusal");
}

describe("paradiseRequest", () => {
  it("sends the key to the configured HTTPS origin and refuses to follow redirects", async () => {
    process.env.PARADISEMODERN_URL = "https://api.example.test/v1/";
    resetEnvForTests();
    await paradiseRequest("/api/site-self/me", { method: "GET" });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://api.example.test/api/site-self/me");
    expect(calls[0]!.init.redirect).toBe("error");
    expect((calls[0]!.init.headers as Record<string, string>)["x-api-key"]).toBe("site-key");
  });

  it("never sends the key over plain HTTP to a non-loopback host", async () => {
    // Refused when the setting is read, and again by the URL rule itself.
    process.env.PARADISEMODERN_URL = "http://api.example.test";
    resetEnvForTests();
    expect(() => env()).toThrow(/PARADISEMODERN_URL/);
    process.env.PARADISEMODERN_URL = "http://127.0.0.1:4010";
    resetEnvForTests();
    expect(env().PARADISEMODERN_URL).toBe("http://127.0.0.1:4010");
    let error: unknown;
    try {
      paradiseUrl("http://api.example.test", "/api/site-self/me");
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(ParadiseRequestError);
    expect((error as ParadiseRequestError).code).toBe("insecure_url");
    expect(calls).toHaveLength(0);
  });

  it("gives up after its time limit and reports it as retryable", async () => {
    setParadiseFetchForTests(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(new DOMException("timed out", "TimeoutError")));
        }),
    );
    const started = Date.now();
    const error = await refusal(paradiseRequest("/api/x", { timeoutMs: 50 }));
    expect(error.code).toBe("unreachable");
    expect(error.retryable).toBe(true);
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it("reads at most 256 KiB of a body, even one with no content-length", async () => {
    const big = JSON.stringify({ allow: true, pad: "x".repeat(300 * 1024) });
    setParadiseFetchForTests(async () => {
      const bytes = new TextEncoder().encode(big);
      let sent = 0;
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (sent >= bytes.length) return controller.close();
          controller.enqueue(bytes.subarray(sent, sent + 16 * 1024));
          sent += 16 * 1024;
        },
      });
      return new Response(stream, { status: 200 });
    });
    const { body } = await paradiseRequest<Record<string, unknown>>("/api/x");
    expect(body).toEqual({});

    setParadiseFetchForTests(async () => new Response(JSON.stringify({ allow: true }), { status: 200 }));
    expect((await paradiseRequest<Record<string, unknown>>("/api/x")).body).toEqual({ allow: true });
  });

  it("accepts project ids issued before the lowercase-slug convention", () => {
    process.env.PARADISEMODERN_PROJECT = "Legacy_Site-01";
    resetEnvForTests();
    try {
      expect(env().PARADISEMODERN_PROJECT).toBe("Legacy_Site-01");
      process.env.PARADISEMODERN_PROJECT = "bad id";
      resetEnvForTests();
      expect(() => env()).toThrow(/PARADISEMODERN_PROJECT/);
    } finally {
      delete process.env.PARADISEMODERN_PROJECT;
      resetEnvForTests();
    }
  });

  it("allows plain HTTP on loopback only, for tests and local development", () => {
    expect(paradiseUrl("http://127.0.0.1:4010", "/api/x")).toBe("http://127.0.0.1:4010/api/x");
    expect(paradiseUrl("http://localhost:4010", "/api/x")).toBe("http://localhost:4010/api/x");
    expect(paradiseUrl("http://[::1]:4010", "/api/x")).toBe("http://[::1]:4010/api/x");
  });

  it("refuses a path that would carry the key to another origin", () => {
    for (const path of ["//evil.example/x", "https://evil.example/x", "/x?y=@evil", "api/x", "/x#y"]) {
      expect(() => paradiseUrl("https://api.example.test", path), path).toThrow(ParadiseRequestError);
    }
    expect(() => paradiseUrl("https://user:pw@api.example.test", "/x")).toThrow(/https/);
  });

  it("fails closed in the public playground, before any request", async () => {
    process.env.FREEHOLDER_PLAYGROUND = "1";
    resetEnvForTests();
    const error = await refusal(paradiseRequest("/api/site-self/me"));
    expect(error.code).toBe("playground");
    expect(calls).toHaveLength(0);
  });

  it("refuses without a key, and keeps a refusal's body out of the error", async () => {
    delete process.env.PARADISEMODERN_API_KEY;
    resetEnvForTests();
    expect((await refusal(paradiseRequest("/api/x"))).code).toBe("not_configured");

    process.env.PARADISEMODERN_API_KEY = "site-key";
    resetEnvForTests();
    setParadiseFetchForTests(async () =>
      new Response(JSON.stringify({ code: "EMAIL_CONSENT_REQUIRED", echo: "visitor words" }), { status: 409 }),
    );
    const error = await refusal(paradiseRequest("/api/x", { body: { message: "visitor words" } }));
    expect(error.code).toBe("EMAIL_CONSENT_REQUIRED");
    expect(error.status).toBe(409);
    expect(error.retryable).toBe(false);
    expect(error.message).not.toContain("visitor words");
  });

  it("marks transport failures, throttling and server errors retryable", async () => {
    setParadiseFetchForTests(async () => {
      throw new TypeError("redirect mode is set to error");
    });
    expect((await refusal(paradiseRequest("/api/x"))).retryable).toBe(true);
    setParadiseFetchForTests(async () => new Response("", { status: 429 }));
    expect((await refusal(paradiseRequest("/api/x"))).retryable).toBe(true);
    setParadiseFetchForTests(async () => new Response("", { status: 503 }));
    expect((await refusal(paradiseRequest("/api/x"))).retryable).toBe(true);
  });
});

describe("paradiseBaseUrl", () => {
  it("defaults to the provider's host and drops a trailing /v1", () => {
    expect(paradiseBaseUrl(undefined)).toBe("https://paradisemodern.com");
    expect(paradiseBaseUrl("https://api.example.test/v1")).toBe("https://api.example.test");
    expect(paradiseBaseUrl("https://api.example.test///")).toBe("https://api.example.test");
  });
});
