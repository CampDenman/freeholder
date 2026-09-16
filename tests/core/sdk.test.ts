// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Typed @freeholder/sdk from the live registry (C3.03).
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { generateSdkCatalog } from "@/core/contract/sdk";
import { PLATFORM_VERSION as platform } from "@/core/platform";
import { ready } from "@/core/runtime";
import { listExternalServices } from "@/core/service";
import {
  createClient,
  FreeholderError,
  PAGEABLE_SERVICES,
  PLATFORM_VERSION,
  SERVICE_NAMES,
} from "../../packages/sdk/src/index";
import { closeDb, hasDatabase } from "../helpers/spine";

const generatedPath = resolve("packages/sdk/src/generated.ts");

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

describe("freeholder sdk transport and wrappers (C3.03)", () => {
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
    await expect(client.call("contacts.create", { name: "Ada" })).resolves.toEqual({
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
    const error = await client.call("contacts.create", { name: "Ada" }).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(FreeholderError);
    expect(error).toMatchObject({ status: 403, code: "permission", message: "No." });
  });

  it("namespaced api methods share the generated transport", async () => {
    const seen: string[] = [];
    const client = createClient({
      baseUrl: "https://studio.example",
      fetch: async (input: RequestInfo | URL) => {
        seen.push(requestUrl(input));
        return new Response(JSON.stringify({ rows: [], total: 0 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    });
    await client.api.contacts.list({ limit: 10 });
    expect(seen[0]).toBe("https://studio.example/api/v1/contacts.list");
  });

  it("withToken returns a client that presents the new key", async () => {
    const seen: Array<string | null> = [];
    const client = createClient({
      baseUrl: "https://studio.example",
      token: "old",
      fetch: async (_input: RequestInfo | URL, init?: RequestInit) => {
        seen.push(new Headers(init?.headers).get("authorization"));
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    });
    await client.withToken("fh_new").call("contacts.list", {});
    expect(seen[0]).toBe("Bearer fh_new");
  });

  it("paginate walks offset until total is reached", async () => {
    const offsets: number[] = [];
    const client = createClient({
      baseUrl: "https://studio.example",
      fetch: async (_input: RequestInfo | URL, init?: RequestInit) => {
        const raw = init?.body;
        const body = JSON.parse(typeof raw === "string" ? raw : "{}") as {
          offset?: number;
        };
        offsets.push(body.offset ?? -1);
        const offset = body.offset ?? 0;
        const rows = offset === 0 ? [{ id: "a" }, { id: "b" }] : [{ id: "c" }];
        return new Response(JSON.stringify({ rows, total: 3 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    });
    const ids: string[] = [];
    for await (const row of client.paginate("contacts.list", { limit: 2 })) {
      ids.push((row as { id: string }).id);
    }
    expect(ids).toEqual(["a", "b", "c"]);
    expect(offsets).toEqual([0, 2]);
  });

  it("still posts instance-specific plugin names the published catalog may not list", async () => {
    const seen: string[] = [];
    const client = createClient({
      baseUrl: "https://studio.example",
      fetch: async (input: RequestInfo | URL) => {
        seen.push(requestUrl(input));
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    });
    await client.call("acmeWidget.sync", { ok: true });
    expect(seen[0]).toBe("https://studio.example/api/v1/acmeWidget.sync");
  });
});

describe.runIf(hasDatabase)("generated SDK catalog matches the live registry (C3.03)", () => {
  afterAll(closeDb);

  it("is regenerated from listExternalServices and refuses drift", async () => {
    await ready();
    const catalog = generateSdkCatalog();
    const live = [...listExternalServices().keys()].sort();
    expect(catalog.names).toEqual(live);
    expect(catalog.names).toContain("contacts.create");
    expect(catalog.names).not.toContain("briefing.assemble");
    expect(catalog.pageable).toContain("contacts.list");
    expect(catalog.source).toContain("export interface ServiceCatalog");
    expect(catalog.source).toContain("export interface FreeholderApi");

    if (process.env.UPDATE_SDK === "1") {
      writeFileSync(generatedPath, catalog.source);
    }
    expect(readFileSync(generatedPath, "utf8")).toBe(catalog.source);

    if (process.env.UPDATE_SDK !== "1") {
      expect([...SERVICE_NAMES]).toEqual(catalog.names);
      expect([...PAGEABLE_SERVICES]).toEqual(catalog.pageable);
    }
  });
});
