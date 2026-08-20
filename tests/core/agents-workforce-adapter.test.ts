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
import { workforceAdapter } from "@/adapters/agent/workforce";
import type { WorkforceTurnRequest } from "@/adapters/agent/workforce-types";
import { connectAgentRuntime } from "@/core/agents/service";
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

  it("uses the gateway's auth header, token field and default model for pm_brain", async () => {
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
      id: "pm_brain",
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
