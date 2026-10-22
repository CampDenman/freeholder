// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The managed workforce adapter family (C4.05, MASTER.md §40): provider and
// model selection, wire-format shaping, and the honesty of every failure.
import { afterEach, afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  anthropicWorkforceAdapter,
  setWorkforceAnthropicFetchForTests,
  toAnthropicMessages,
} from "@/adapters/agent/workforce-anthropic";
import {
  openAiCompatibleWorkforceAdapter,
  setWorkforceOpenAiFetchForTests,
} from "@/adapters/agent/workforce-openai";
import { readFileSync } from "node:fs";
import { eq, sql } from "drizzle-orm";
import { builderAgent } from "@/adapters/agent";
import { setBuilderAgentFetchForTests } from "@/adapters/agent/gateway";
import { WORKFORCE_ADAPTER_IDS, workforceAdapter } from "@/adapters/agent/workforce";
import type { WorkforceTurnRequest } from "@/adapters/agent/workforce-types";
import { agentConnections } from "@/core/agents/schema";
import { connectAgentRuntime } from "@/core/agents/service";
import { resetEnvForTests } from "@/core/env";
import { runDoctor } from "@/core/doctor";
import { db } from "@/core/db";
import { users } from "@/core/auth/schema";
import { closeDb, failure, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

function turnRequest(overrides: Partial<WorkforceTurnRequest> = {}): WorkforceTurnRequest {
  return {
    model: "claude-opus-5",
    system: "You are a worker.",
    messages: [{ role: "user", content: "Rename Rae." }],
    tools: [
      {
        type: "function",
        function: {
          name: "contacts_update",
          description: "Change a contact.",
          parameters: { type: "object", properties: {} },
        },
      },
    ],
    maxOutputTokens: 2000,
    requestId: "run-1",
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  setWorkforceAnthropicFetchForTests(undefined);
  setWorkforceOpenAiFetchForTests(undefined);
});

describe("the anthropic workforce adapter", () => {
  it("speaks the Messages API and parses tool use back", async () => {
    let seenUrl = "";
    let seenHeaders: Record<string, string> = {};
    let seenBody: Record<string, unknown> = {};
    setWorkforceAnthropicFetchForTests(async (url, init) => {
      seenUrl = url;
      seenHeaders = init.headers as Record<string, string>;
      seenBody = JSON.parse(init.body as string) as Record<string, unknown>;
      return jsonResponse({
        model: "claude-opus-5",
        stop_reason: "tool_use",
        content: [
          { type: "text", text: "Renaming now." },
          { type: "tool_use", id: "tu_1", name: "contacts_update", input: { name: "Rae Lane" } },
        ],
        usage: { input_tokens: 120, output_tokens: 40 },
      });
    });
    const adapter = anthropicWorkforceAdapter({
      apiKey: "test-key",
      credentialRef: "ANTHROPIC_API_KEY",
      baseUrl: null,
      model: "claude-opus-5",
    });
    const result = await adapter.turn(turnRequest());
    expect(seenUrl).toBe("https://api.anthropic.com/v1/messages");
    expect(seenHeaders["x-api-key"]).toBe("test-key");
    expect(seenHeaders["anthropic-version"]).toBe("2023-06-01");
    expect(seenBody.system).toBe("You are a worker.");
    expect(seenBody.tools).toEqual([
      {
        name: "contacts_update",
        description: "Change a contact.",
        input_schema: { type: "object", properties: {} },
      },
    ]);
    expect(result.stop).toBe("tool_calls");
    expect(result.text).toBe("Renaming now.");
    expect(result.toolCalls).toEqual([
      { id: "tu_1", name: "contacts_update", arguments: { name: "Rae Lane" } },
    ]);
    expect(result.usage).toEqual({ inputTokens: 120, outputTokens: 40, totalTokens: 160 });
  });

  it("merges consecutive tool results into one user turn", () => {
    // Parallel tool results split across messages quietly teach the model to
    // stop calling tools in parallel — so the transcript never does that.
    const wire = toAnthropicMessages([
      { role: "user", content: "Do two things." },
      {
        role: "assistant",
        content: null,
        toolCalls: [
          { id: "a", name: "one", arguments: {} },
          { id: "b", name: "two", arguments: {} },
        ],
      },
      { role: "tool", toolCallId: "a", content: "done one" },
      { role: "tool", toolCallId: "b", content: "done two" },
    ]);
    expect(wire).toHaveLength(3);
    expect(wire[2]).toEqual({
      role: "user",
      content: [
        { type: "tool_result", tool_use_id: "a", content: "done one" },
        { type: "tool_result", tool_use_id: "b", content: "done two" },
      ],
    });
  });

  it("never echoes a provider error body", async () => {
    setWorkforceAnthropicFetchForTests(async () =>
      jsonResponse({ error: { message: "secret request echo" } }, 500),
    );
    const adapter = anthropicWorkforceAdapter({
      apiKey: "test-key",
      credentialRef: "ANTHROPIC_API_KEY",
      baseUrl: null,
      model: "claude-opus-5",
    });
    const refused = await adapter.turn(turnRequest()).catch((error: Error) => error);
    expect(refused).toBeInstanceOf(Error);
    expect((refused as Error).message).toBe("The workforce model returned HTTP 500.");
  });
});

describe("the openai-compatible workforce adapter", () => {
  it("speaks chat completions with a bearer token for openai", async () => {
    let seenUrl = "";
    let seenHeaders: Record<string, string> = {};
    let seenBody: Record<string, unknown> = {};
    setWorkforceOpenAiFetchForTests(async (url, init) => {
      seenUrl = url;
      seenHeaders = init.headers as Record<string, string>;
      seenBody = JSON.parse(init.body as string) as Record<string, unknown>;
      return jsonResponse({
        model: "gpt-test",
        choices: [
          {
            finish_reason: "tool_calls",
            message: {
              content: null,
              tool_calls: [
                { id: "call_1", function: { name: "contacts_update", arguments: '{"name":"Rae Lane"}' } },
              ],
            },
          },
        ],
        usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
      });
    });
    const adapter = openAiCompatibleWorkforceAdapter({
      id: "openai",
      apiKey: "sk-test",
      credentialRef: "OPENAI_API_KEY",
      baseUrl: null,
      model: "gpt-test",
    });
    const result = await adapter.turn(turnRequest({ model: "gpt-test" }));
    expect(seenUrl).toBe("https://api.openai.com/v1/chat/completions");
    expect(seenHeaders.authorization).toBe("Bearer sk-test");
    expect(seenBody.max_completion_tokens).toBe(2000);
    expect((seenBody.messages as unknown[])[0]).toEqual({
      role: "system",
      content: "You are a worker.",
    });
    expect(result.toolCalls).toEqual([
      { id: "call_1", name: "contacts_update", arguments: { name: "Rae Lane" } },
    ]);
    expect(result.stop).toBe("tool_calls");
  });

  it("speaks to any OpenAI-compatible gateway with a bearer token and the named model", async () => {
    let seenUrl = "";
    let seenHeaders: Record<string, string> = {};
    let seenBody: Record<string, unknown> = {};
    setWorkforceOpenAiFetchForTests(async (url, init) => {
      seenUrl = url;
      seenHeaders = init.headers as Record<string, string>;
      seenBody = JSON.parse(init.body as string) as Record<string, unknown>;
      return jsonResponse({
        choices: [{ finish_reason: "stop", message: { content: "Done." } }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      });
    });
    const adapter = openAiCompatibleWorkforceAdapter({
      id: "gateway",
      apiKey: "gw-key",
      credentialRef: "AGENT_GATEWAY_API_KEY",
      baseUrl: "https://llm.example.test/",
      model: "open-model-7b",
    });
    expect(adapter.configured).toBe(true);
    expect(adapter.defaultModel).toBe("open-model-7b");
    await adapter.turn(turnRequest({ model: "open-model-7b" }));
    expect(seenUrl).toBe("https://llm.example.test/v1/chat/completions");
    expect(seenHeaders.authorization).toBe("Bearer gw-key");
    expect(seenHeaders["x-api-key"]).toBeUndefined();
    expect(seenBody.max_tokens).toBe(2000);
    expect(seenBody.request_id).toBeUndefined();
  });

  it("does not guess a gateway's host", async () => {
    const adapter = openAiCompatibleWorkforceAdapter({
      id: "gateway",
      apiKey: "gw-key",
      credentialRef: "AGENT_GATEWAY_API_KEY",
      baseUrl: null,
      model: "open-model-7b",
    });
    expect(adapter.configured).toBe(false);
    await expect(adapter.turn(turnRequest())).rejects.toThrow(/base URL/);
  });

  it("uses Paradise's auth header, token field and default model for the paradise provider", async () => {
    let seenUrl = "";
    let seenHeaders: Record<string, string> = {};
    let seenBody: Record<string, unknown> = {};
    setWorkforceOpenAiFetchForTests(async (url, init) => {
      seenUrl = url;
      seenHeaders = init.headers as Record<string, string>;
      seenBody = JSON.parse(init.body as string) as Record<string, unknown>;
      return jsonResponse({
        choices: [{ finish_reason: "stop", message: { content: "Done." } }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      });
    });
    const adapter = openAiCompatibleWorkforceAdapter({
      id: "paradise",
      apiKey: "pm-key",
      credentialRef: "PARADISEMODERN_API_KEY",
      baseUrl: null,
      model: null,
    });
    expect(adapter.defaultModel).toBe("pm-brain:quality");
    const result = await adapter.turn(turnRequest({ model: "pm-brain:quality" }));
    expect(seenUrl).toBe("https://paradisemodern.com/v1/chat/completions");
    expect(seenHeaders["x-api-key"]).toBe("pm-key");
    expect(seenBody.max_tokens).toBe(2000);
    expect(seenBody.request_id).toBe("run-1");
    expect(result.text).toBe("Done.");
    expect(result.stop).toBe("end");
  });

  it("refuses tool arguments that are not valid JSON", async () => {
    setWorkforceOpenAiFetchForTests(async () =>
      jsonResponse({
        choices: [
          {
            finish_reason: "tool_calls",
            message: {
              tool_calls: [{ id: "call_1", function: { name: "x", arguments: "{broken" } }],
            },
          },
        ],
      }),
    );
    const adapter = openAiCompatibleWorkforceAdapter({
      id: "openai",
      apiKey: "sk-test",
      credentialRef: "OPENAI_API_KEY",
      baseUrl: null,
      model: "gpt-test",
    });
    await expect(adapter.turn(turnRequest({ model: "gpt-test" }))).rejects.toThrow(
      /not valid JSON/,
    );
  });
});

describe("the §37 builder's provider choice (owner decision 2026-10-22)", () => {
  const BUILDER_ENV = [
    "FREEHOLDER_AGENT",
    "AGENT_GATEWAY_URL",
    "AGENT_GATEWAY_API_KEY",
    "AGENT_GATEWAY_MODEL",
    "PARADISEMODERN_API_KEY",
    "PARADISEMODERN_URL",
  ] as const;
  const prior = Object.fromEntries(BUILDER_ENV.map((name) => [name, process.env[name]]));
  const proposal = {
    system: "You build sites.",
    ownerBrief: "Add a gallery.",
    tool: {
      type: "function" as const,
      function: { name: "propose", description: "Propose.", parameters: { type: "object", properties: {} } },
    },
    maxOutputTokens: 1000,
    requestId: "builder-1",
  };
  let seen: { url: string; headers: Record<string, string>; body: Record<string, unknown> } | null = null;

  beforeEach(() => {
    for (const name of BUILDER_ENV) delete process.env[name];
    resetEnvForTests();
    seen = null;
    setBuilderAgentFetchForTests(async (url, init) => {
      seen = {
        url,
        headers: init.headers as Record<string, string>,
        body: JSON.parse(init.body as string) as Record<string, unknown>,
      };
      return jsonResponse({
        model: "served-model",
        choices: [{ message: { tool_calls: [{ function: { name: "propose", arguments: "{\"ok\":true}" } }] } }],
      });
    });
  });

  afterAll(() => {
    setBuilderAgentFetchForTests(undefined);
    for (const name of BUILDER_ENV) {
      if (prior[name] === undefined) delete process.env[name];
      else process.env[name] = prior[name];
    }
    resetEnvForTests();
  });

  it("reaches a neutral OpenAI-compatible gateway with a bearer token", async () => {
    process.env.FREEHOLDER_AGENT = "gateway";
    process.env.AGENT_GATEWAY_URL = "https://llm.example.test";
    process.env.AGENT_GATEWAY_API_KEY = "gw-key";
    process.env.AGENT_GATEWAY_MODEL = "open-model-7b";
    resetEnvForTests();
    const agent = builderAgent();
    expect(agent.id).toBe("gateway");
    expect(agent.configured).toBe(true);
    const result = await agent.propose(proposal);
    expect(result.arguments).toEqual({ ok: true });
    expect(seen?.url).toBe("https://llm.example.test/v1/chat/completions");
    expect(seen?.headers.authorization).toBe("Bearer gw-key");
    expect(seen?.headers["x-api-key"]).toBeUndefined();
    expect(seen?.body.model).toBe("open-model-7b");
    expect(seen?.body.request_id).toBeUndefined();
  });

  it("refuses a gateway with no URL or model rather than defaulting to any provider", async () => {
    process.env.FREEHOLDER_AGENT = "gateway";
    process.env.AGENT_GATEWAY_API_KEY = "gw-key";
    resetEnvForTests();
    const agent = builderAgent();
    expect(agent.configured).toBe(false);
    await expect(agent.propose(proposal)).rejects.toThrow(
      /AGENT_GATEWAY_URL, AGENT_GATEWAY_MODEL/,
    );
    expect(seen).toBeNull();
  });

  it("keeps FREEHOLDER_AGENT=pm_brain and PARADISEMODERN_API_KEY working as the Paradise provider", async () => {
    process.env.FREEHOLDER_AGENT = "pm_brain";
    process.env.PARADISEMODERN_API_KEY = "pm-key";
    resetEnvForTests();
    const agent = builderAgent();
    expect(agent.id).toBe("paradise");
    expect(agent.configured).toBe(true);
    await agent.propose(proposal);
    expect(seen?.url).toBe("https://paradisemodern.com/v1/chat/completions");
    expect(seen?.headers["x-api-key"]).toBe("pm-key");
    expect(seen?.body.model).toBe("pm-brain:quality");
    expect(seen?.body.request_id).toBe("builder-1");
  });

  it("is off with no configuration at all", () => {
    expect(builderAgent().id).toBe("none");
  });
});

describe("workforce adapter selection", () => {
  it("refuses an unknown adapter honestly", async () => {
    const adapter = workforceAdapter({
      adapter: "mystery",
      model: null,
      credentialRef: null,
      baseUrl: null,
    });
    expect(adapter.id).toBe("none");
    expect(adapter.configured).toBe(false);
    await expect(
      adapter.turn(turnRequest()),
    ).rejects.toThrow(/No workforce adapter called "mystery"/);
  });

  it("reads the environment variable the connection names", () => {
    process.env.TEST_WORKFORCE_KEY = "custom-secret";
    try {
      const adapter = workforceAdapter({
        adapter: "anthropic",
        model: null,
        credentialRef: "TEST_WORKFORCE_KEY",
        baseUrl: null,
      });
      expect(adapter.configured).toBe(true);
      expect(adapter.credentialRef).toBe("TEST_WORKFORCE_KEY");
      expect(adapter.defaultModel).toBe("claude-opus-5");
    } finally {
      delete process.env.TEST_WORKFORCE_KEY;
    }
  });

  it("lists neutral providers, with Paradise as one optional choice", () => {
    expect([...WORKFORCE_ADAPTER_IDS]).toEqual(["anthropic", "openai", "gateway", "paradise"]);
    expect(WORKFORCE_ADAPTER_IDS).not.toContain("pm_brain");
  });

  it("still runs a connection stored under the deprecated pm_brain name", () => {
    process.env.PARADISEMODERN_API_KEY = "legacy-key";
    try {
      const adapter = workforceAdapter({
        adapter: "pm_brain",
        model: null,
        credentialRef: null,
        baseUrl: null,
      });
      expect(adapter.id).toBe("paradise");
      expect(adapter.configured).toBe(true);
      expect(adapter.credentialRef).toBe("PARADISEMODERN_API_KEY");
      expect(adapter.defaultModel).toBe("pm-brain:quality");
    } finally {
      delete process.env.PARADISEMODERN_API_KEY;
    }
  });

  it("names the missing variable when unconfigured", async () => {
    delete process.env.TEST_WORKFORCE_MISSING;
    const adapter = workforceAdapter({
      adapter: "anthropic",
      model: null,
      credentialRef: "TEST_WORKFORCE_MISSING",
      baseUrl: null,
    });
    expect(adapter.configured).toBe(false);
    await expect(adapter.turn(turnRequest())).rejects.toThrow(/TEST_WORKFORCE_MISSING/);
  });
});

describe.runIf(hasDatabase)("managed connections end to end", { timeout: 30_000 }, () => {
  beforeEach(async () => {
    await truncateSpine();
    await db()
      .insert(users)
      .values({ id: OWNER.userId, email: "owner@example.test", role: "owner" })
      .onConflictDoNothing();
  }, 30_000);
  afterAll(closeDb);

  it("refuses a managed connection whose adapter is not installed", async () => {
    const refused = await failure(
      connectAgentRuntime.call(
        { name: "Mystery runtime", kind: "managed", adapter: "mystery" },
        OWNER,
      ),
    );
    expect(refused.code).toBe("validation");
    expect(refused.message).toContain("anthropic");
  });

  it("requires a model for openai and not for anthropic", async () => {
    const refused = await failure(
      connectAgentRuntime.call(
        { name: "OpenAI runtime", kind: "managed", adapter: "openai" },
        OWNER,
      ),
    );
    expect(refused.code).toBe("validation");
    const accepted = await connectAgentRuntime.call(
      { name: "Claude runtime", kind: "managed", adapter: "anthropic" },
      OWNER,
    );
    expect(accepted.kind).toBe("managed");
  });

  it("requires a gateway model and stores the deprecated pm_brain name as paradise", async () => {
    const refused = await failure(
      connectAgentRuntime.call(
        { name: "Gateway runtime", kind: "managed", adapter: "gateway" },
        OWNER,
      ),
    );
    expect(refused.code).toBe("validation");
    const legacy = await connectAgentRuntime.call(
      { name: "Legacy runtime", kind: "managed", adapter: "pm_brain" },
      OWNER,
    );
    expect(legacy.adapter).toBe("paradise");
  });

  it("migration 0055 renames stored pm_brain connections to paradise", async () => {
    await db().insert(agentConnections).values({
      name: "Stored legacy runtime",
      kind: "managed",
      adapter: "pm_brain",
    });
    await db().execute(
      sql.raw(readFileSync("db/migrations/0055_neutral_agent_adapter_ids.sql", "utf8")),
    );
    const [row] = await db()
      .select({ adapter: agentConnections.adapter })
      .from(agentConnections)
      .where(eq(agentConnections.name, "Stored legacy runtime"));
    expect(row?.adapter).toBe("paradise");
  });

  it("doctor names the missing credential without spending a cent", async () => {
    await connectAgentRuntime.call(
      {
        name: "Claude runtime",
        kind: "managed",
        adapter: "anthropic",
        credentialRef: "TEST_WORKFORCE_DOCTOR_KEY",
      },
      OWNER,
    );
    delete process.env.TEST_WORKFORCE_DOCTOR_KEY;
    const missing = await runDoctor();
    const check = missing.checks.find(
      (candidate) =>
        candidate.id === "agents.managedConnections" &&
        candidate.title.includes("Claude runtime"),
    );
    expect(check?.verdict).toBe("fail");
    expect(check?.detail).toContain("TEST_WORKFORCE_DOCTOR_KEY");

    process.env.TEST_WORKFORCE_DOCTOR_KEY = "present";
    try {
      const configured = await runDoctor();
      const healthy = configured.checks.find(
        (candidate) =>
          candidate.id === "agents.managedConnections" &&
          candidate.title.includes("Claude runtime"),
      );
      expect(healthy?.verdict).toBe("ok");
      expect(healthy?.detail).toContain("claude-opus-5");
    } finally {
      delete process.env.TEST_WORKFORCE_DOCTOR_KEY;
    }
  });
});
