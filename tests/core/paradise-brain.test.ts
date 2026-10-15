// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.33: PM Brain as a generation adapter, and the gateway headers it shares
// with the §37 builder and the workforce. Mocked HTTP only.
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPmBrainAi } from "@/adapters/ai/pm-brain";
import { aiAdapters } from "@/adapters/ai";
import { pmBrainAdapter, setBuilderAgentFetchForTests } from "@/adapters/agent/pm-brain";
import {
  openAiCompatibleWorkforceAdapter,
  setWorkforceOpenAiFetchForTests,
} from "@/adapters/agent/workforce-openai";
import { paradiseBaseUrl, pmBrainGatewayHeaders } from "@/adapters/paradise/config";
import { AdapterError } from "@/adapters/types";
import { resetEnvForTests } from "@/core/env";
import { assistantAdapter } from "@/modules/assistant/provider";

const changed = new Map<string, string | undefined>();
function environment(values: Record<string, string | undefined>): void {
  for (const [name, value] of Object.entries(values)) {
    if (!changed.has(name)) changed.set(name, process.env[name]);
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  resetEnvForTests();
}

afterEach(() => {
  for (const [name, value] of changed) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  changed.clear();
  resetEnvForTests();
  setBuilderAgentFetchForTests(undefined);
  setWorkforceOpenAiFetchForTests(undefined);
  vi.restoreAllMocks();
});

const REQUEST = {
  purpose: "assistant",
  system: "Answer briefly.",
  input: "Are you open on Sunday?",
  maxOutputTokens: 200,
  idempotencyKey: "turn-1",
};

function completion(content = "Yes, from ten.") {
  return new Response(
    JSON.stringify({
      model: "pm-brain",
      choices: [{ message: { content } }],
      usage: { prompt_tokens: 12, completion_tokens: 4 },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

describe("PM Brain generation adapter", () => {
  it("calls the gateway with the site key, billing project and default lane", async () => {
    environment({
      PARADISEMODERN_BILLING_PROJECT: "freeholder-sites",
      PARADISEMODERN_FALLBACK_POLICY: undefined,
    });
    const fetchImpl = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => completion());
    const adapter = createPmBrainAi({
      apiKey: "site-key",
      baseUrl: "https://pm.example.test/v1/",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const result = await adapter.generate(REQUEST);

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://pm.example.test/v1/chat/completions");
    const headers = init!.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("site-key");
    expect(headers["x-pm-project"]).toBe("freeholder-sites");
    // Unset policy means PM's normal routing: the header is absent, not "allow".
    expect(headers).not.toHaveProperty("x-pm-fallback-policy");
    expect(headers).not.toHaveProperty("authorization");
    const body = JSON.parse(init!.body as string) as Record<string, unknown>;
    expect(body.model).toBe("pm-brain");
    expect(body.request_id).toBe("turn-1");
    expect(result).toMatchObject({
      text: "Yes, from ten.",
      provider: "pm_brain",
      usage: { inputTokens: 12, outputTokens: 4, totalTokens: 16 },
    });
  });

  it("sends a configured fallback policy and an owner-chosen lane", async () => {
    environment({
      PARADISEMODERN_BILLING_PROJECT: "freeholder-sites",
      PARADISEMODERN_FALLBACK_POLICY: "none",
    });
    const fetchImpl = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => completion());
    await createPmBrainAi({
      apiKey: "site-key",
      model: "pm-brain:quality",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    }).generate(REQUEST);
    const init = fetchImpl.mock.calls[0]![1]!;
    expect((init.headers as Record<string, string>)["x-pm-fallback-policy"]).toBe("none");
    expect(JSON.parse(init.body as string)).toMatchObject({ model: "pm-brain:quality" });
  });

  it("refuses before any request when no billing project is configured", async () => {
    environment({ PARADISEMODERN_BILLING_PROJECT: undefined });
    const fetchImpl = vi.fn();
    const error = await createPmBrainAi({
      apiKey: "site-key",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    }).generate(REQUEST).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AdapterError);
    expect((error as AdapterError).message).toContain("PARADISEMODERN_BILLING_PROJECT");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("maps refusals without echoing the provider body", async () => {
    environment({ PARADISEMODERN_BILLING_PROJECT: "freeholder-sites" });
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ error: { message: "visitor words echoed" } }), { status: 429 }),
    );
    const error = (await createPmBrainAi({
      apiKey: "site-key",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    }).generate(REQUEST).catch((caught: unknown) => caught)) as AdapterError;
    expect(error.code).toBe("rate_limited");
    expect(error.retryable).toBe(true);
    expect(error.message).not.toContain("visitor words");
  });

  it("is unavailable without a site key and registered under adapters.ai", () => {
    expect(createPmBrainAi({}).status.available).toBe(false);
    expect(aiAdapters.get("pm_brain").id).toBe("pm_brain");
  });
});

describe("shared gateway configuration", () => {
  it("normalizes the base URL with or without /v1", () => {
    expect(paradiseBaseUrl("https://paradisemodern.com/v1")).toBe("https://paradisemodern.com");
    expect(paradiseBaseUrl("https://paradisemodern.com/")).toBe("https://paradisemodern.com");
    expect(paradiseBaseUrl(undefined)).toBe("https://paradisemodern.com");
  });

  it("puts the billing project on builder proposals", async () => {
    environment({
      PARADISEMODERN_API_KEY: "site-key",
      PARADISEMODERN_URL: "https://paradisemodern.com/v1",
      PARADISEMODERN_BILLING_PROJECT: "freeholder-sites",
    });
    const fetchImpl = vi.fn(async (_url: string, _init: RequestInit) =>
      new Response(
        JSON.stringify({
          choices: [{
            message: {
              tool_calls: [{ function: { name: "propose", arguments: "{\"ok\":true}" } }],
            },
          }],
        }),
        { status: 200 },
      ),
    );
    setBuilderAgentFetchForTests(fetchImpl);
    const result = await pmBrainAdapter().propose({
      system: "s",
      ownerBrief: "b",
      tool: { type: "function", function: { name: "propose", description: "d", parameters: {} } },
      maxOutputTokens: 100,
      requestId: "r-1",
    } as unknown as Parameters<ReturnType<typeof pmBrainAdapter>["propose"]>[0]);
    expect(result.arguments).toEqual({ ok: true });
    const [url, init] = fetchImpl.mock.calls[0]!;
    // The old code produced /v1/v1/… for a URL written with /v1.
    expect(url).toBe("https://paradisemodern.com/v1/chat/completions");
    expect((init.headers as Record<string, string>)["x-pm-project"]).toBe("freeholder-sites");
  });

  it("puts the billing project on workforce gateway turns", async () => {
    environment({ PARADISEMODERN_BILLING_PROJECT: "freeholder-sites" });
    const fetchImpl = vi.fn(async (_url: string, _init: RequestInit) =>
      new Response(
        JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: "done" } }] }),
        { status: 200 },
      ),
    );
    setWorkforceOpenAiFetchForTests(fetchImpl);
    await openAiCompatibleWorkforceAdapter({
      id: "pm_brain",
      apiKey: "site-key",
      credentialRef: "PARADISEMODERN_API_KEY",
      baseUrl: null,
      model: null,
    }).turn({
      model: "pm-brain:quality",
      system: "s",
      messages: [{ role: "user", content: "hi" }],
      tools: [],
      maxOutputTokens: 50,
      requestId: "w-1",
    } as unknown as Parameters<ReturnType<typeof openAiCompatibleWorkforceAdapter>["turn"]>[0]);
    const init = fetchImpl.mock.calls[0]![1];
    expect(fetchImpl.mock.calls[0]![0]).toBe("https://paradisemodern.com/v1/chat/completions");
    expect(init.headers).toMatchObject({ "x-api-key": "site-key", "x-pm-project": "freeholder-sites" });
  });

  it("omits optional headers when they are not configured", () => {
    environment({ PARADISEMODERN_BILLING_PROJECT: undefined, PARADISEMODERN_FALLBACK_POLICY: undefined });
    expect(pmBrainGatewayHeaders("k")).toEqual({ "content-type": "application/json", "x-api-key": "k" });
  });
});

describe("the assistant's PM Brain provider", () => {
  const settings = {
    provider: "pm_brain",
    model: "pm-brain",
    credentialRef: null,
    baseUrl: null,
  } as unknown as Parameters<typeof assistantAdapter>[0];

  it("uses the conventional site key and needs a billing project", () => {
    environment({ PARADISEMODERN_API_KEY: "site-key", PARADISEMODERN_BILLING_PROJECT: undefined });
    const missing = assistantAdapter(settings);
    expect("unconfigured" in missing && missing.unconfigured).toContain("PARADISEMODERN_BILLING_PROJECT");
    environment({ PARADISEMODERN_BILLING_PROJECT: "freeholder-sites" });
    const resolved = assistantAdapter(settings);
    expect("adapter" in resolved && resolved.adapter.id).toBe("pm_brain");
  });
});
