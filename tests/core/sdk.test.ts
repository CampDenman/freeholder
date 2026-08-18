// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// @freeholder/sdk talks to the live RPC the OpenAPI document describes (C3.03).
import { describe, expect, it } from "vitest";
import { createClient, FreeholderError, PLATFORM_VERSION } from "../../packages/sdk/src/index";
import { PLATFORM_VERSION as platform } from "@/core/platform";

describe("freeholder sdk (C3.03)", () => {
  it("publishes the same version as the platform", () => {
    expect(PLATFORM_VERSION).toBe(platform);
  });

  it("POSTs /api/v1/<service> and unwraps a success body", async () => {
    const seen: { url: string; method: string; auth?: string | null }[] = [];
    const client = createClient({
      baseUrl: "https://studio.example",
      token: "fh_test",
      fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
        seen.push({
          url:
            typeof input === "string"
              ? input
              : input instanceof URL
                ? input.href
                : input.url,
          method: String(init?.method),
          auth: new Headers(init?.headers).get("authorization"),
        });
        return new Response(JSON.stringify({ id: "ok" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    });
    await expect(client.call("contacts.create", { email: "a@b.c" })).resolves.toEqual({
      id: "ok",
    });
    expect(seen[0]).toEqual({
      url: "https://studio.example/api/v1/contacts.create",
      method: "POST",
      auth: "Bearer fh_test",
    });
  });

  it("turns an error envelope into FreeholderError", async () => {
    const client = createClient({
      baseUrl: "https://studio.example",
      fetch: async () =>
        new Response(JSON.stringify({ error: { code: "permission", message: "No." } }), {
          status: 403,
          headers: { "content-type": "application/json" },
        }),
    });
    const error = await client.call("contacts.create", {}).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(FreeholderError);
    expect(error).toMatchObject({ status: 403, code: "permission", message: "No." });
  });
});
