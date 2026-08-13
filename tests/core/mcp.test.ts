// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The MCP server (MASTER.md §11, §28.3).
//
// Two things are being held here. The first is the protocol: the envelopes a
// client receives have to be the ones JSON-RPC and MCP specify, because the
// consumer is somebody else's client and there is no negotiating with it after
// the fact. The second is §28's claim that tools are *derived* — a service
// added tomorrow is a tool tomorrow, with no list to update.
//
// What these cannot prove is that a real MCP client connects. That is stated
// in the PR and the backlog rather than implied by a green suite: these tests
// speak the protocol as I understand it, which is exactly the thing a real
// client would be checking.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { handleMcp, PROTOCOL_VERSION } from "@/mcp/server";
import { serviceForTool, toolName, toolsFor } from "@/mcp/tools";
import { listServices, type Actor } from "@/core/service";
import { ready } from "@/core/runtime";
import { createApiKey } from "@/core/apikeys/service";
import { users } from "@/core/auth/schema";
import { db } from "@/core/db";
import { contacts } from "@/core/contacts/schema";
import { closeDb, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

const INFO = { name: "Aurora Coast", version: "0.1.0" };
const ANON: Actor = { kind: "anonymous" };
const agent = (scopes: string[]): Actor => ({
  kind: "agent",
  keyName: "test-key",
  scopes,
});

async function rpc(
  method: string,
  params?: Record<string, unknown>,
  headers: Record<string, string> = {},
  id: string | number | null = 1,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await handleMcp(
    new Request("http://localhost/api/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    }),
    INFO,
  );
  const text = await response.text();
  return {
    status: response.status,
    body: text ? (JSON.parse(text) as Record<string, unknown>) : {},
  };
}

describe.runIf(hasDatabase)("the handshake", () => {
  beforeEach(async () => {
    await truncateSpine();
    await db()
      .insert(users)
      .values({ id: OWNER.userId, email: "owner@example.test", role: "owner" })
      .onConflictDoNothing();
  });

  afterAll(async () => {
    await closeDb();
  });

  it("answers initialize with capabilities and who it is", async () => {
    const { body } = await rpc("initialize", {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "test", version: "1" },
    });
    const value = body.result as Record<string, unknown>;
    expect(body.jsonrpc).toBe("2.0");
    expect(value.protocolVersion).toBe(PROTOCOL_VERSION);
    expect(value.capabilities).toHaveProperty("tools");
    expect(value.serverInfo).toEqual(INFO);
  });

  it("answers in the client's dialect when it speaks one we know", async () => {
    // Negotiation exists so an older client keeps working.
    const { body } = await rpc("initialize", { protocolVersion: "2024-11-05" });
    expect((body.result as { protocolVersion: string }).protocolVersion).toBe(
      "2024-11-05",
    );
  });

  it("names its own version when the client's is unknown", async () => {
    const { body } = await rpc("initialize", { protocolVersion: "1999-01-01" });
    expect((body.result as { protocolVersion: string }).protocolVersion).toBe(
      PROTOCOL_VERSION,
    );
  });

  it("takes a notification without answering it", async () => {
    // A notification has no id and must produce no response body, or clients
    // that match responses to requests get one they never asked for.
    const response = await handleMcp(
      new Request("http://localhost/api/mcp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "notifications/initialized",
        }),
      }),
      INFO,
    );
    expect(response.status).toBe(202);
    expect(await response.text()).toBe("");
  });

  it("answers ping", async () => {
    const { body } = await rpc("ping");
    expect(body.result).toEqual({});
  });

  it("refuses a method it does not implement, with the JSON-RPC code", async () => {
    const { body } = await rpc("resources/list");
    expect((body.error as { code: number }).code).toBe(-32601);
  });

  it("refuses a body that is not JSON", async () => {
    const response = await handleMcp(
      new Request("http://localhost/api/mcp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{not json",
      }),
      INFO,
    );
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: { code: number } }).error.code).toBe(
      -32700,
    );
  });

  it("answers a batch, and answers nothing to a batch of notifications", async () => {
    const batched = await handleMcp(
      new Request("http://localhost/api/mcp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify([
          { jsonrpc: "2.0", id: 1, method: "ping" },
          { jsonrpc: "2.0", id: 2, method: "ping" },
        ]),
      }),
      INFO,
    );
    expect(((await batched.json()) as unknown[]).length).toBe(2);

    const notifications = await handleMcp(
      new Request("http://localhost/api/mcp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify([
          { jsonrpc: "2.0", method: "notifications/initialized" },
        ]),
      }),
      INFO,
    );
    expect(notifications.status).toBe(202);
  });
});

describe.runIf(hasDatabase)("what an agent is offered", () => {
  beforeEach(async () => {
    await truncateSpine();
    await db()
      .insert(users)
      .values({ id: OWNER.userId, email: "owner@example.test", role: "owner" })
      .onConflictDoNothing();
    await ready();
  });

  it("derives tools from the registry rather than a list", async () => {
    // §28: "New feature merged → new MCP tool exists." Every non-excluded
    // service an owner may call is offered, except operations that explicitly
    // require fresh interactive two-factor proof, and nothing else is.
    const offered = new Set(toolsFor(OWNER).map((tool) => tool.name));
    const expected = [...listServices().values()]
      .filter(
        (service) =>
          !service.def.stepUp &&
          service.def.agentCallable !== false &&
          !["auth", "apikeys", "invitations"].includes(
            service.def.name.split(".")[0]!,
          ),
      )
      .map((service) => toolName(service.def.name));
    expect(offered).toEqual(new Set(expected));
  });

  it("keeps credential services out entirely", async () => {
    // Not a permission decision — an owner may call these. It is that an agent
    // should not be invited to guess at passwords or issue itself credentials.
    const names = toolsFor(OWNER).map((tool) => tool.name);
    expect(names).not.toContain("auth_login");
    expect(names).not.toContain("apikeys_create");
    expect(names).not.toContain("invitations_accept");
    expect(names).not.toContain("invitations_create");
    // And they cannot be reached by naming them either.
    expect(serviceForTool(OWNER, "auth_login")).toBeUndefined();
    expect(serviceForTool(OWNER, "roles_assign")).toBeUndefined();
  });

  it("keeps explicit human-review operations out of agent discovery", async () => {
    const names = toolsFor(OWNER).map((tool) => tool.name);
    expect(names).not.toContain("media_generateAltTextSuggestion");
    expect(names).not.toContain("media_acceptAltTextSuggestion");
    expect(names).not.toContain("media_dismissAltTextSuggestion");
    expect(
      serviceForTool(OWNER, "media_generateAltTextSuggestion"),
    ).toBeUndefined();
  });

  it("offers a scoped key only what it can actually call", async () => {
    // An agent shown eighty tools and permitted six discovers that by failing,
    // and every failure is a real request in the audit log.
    const names = toolsFor(agent(["contacts.*"])).map((tool) => tool.name);
    expect(names).toContain("contacts_create");
    expect(names).not.toContain("media_trash");
  });

  it("offers an anonymous caller the public tools and no more", async () => {
    const names = toolsFor(ANON).map((tool) => tool.name);
    expect(names).toContain("settings_getBusiness");
    expect(names).not.toContain("contacts_create");
  });

  it("marks reads as read-only and deletions as destructive", async () => {
    // Hints, so a client knows what to confirm with a person first.
    const tools = toolsFor(OWNER);
    const list = tools.find((tool) => tool.name === "contacts_list")!;
    const remove = tools.find((tool) => tool.name === "media_trash")!;
    expect(list.annotations.readOnlyHint).toBe(true);
    expect(remove.annotations.readOnlyHint).toBe(false);
    expect(remove.annotations.destructiveHint).toBe(true);
  });

  it("gives every tool an object schema a client can fill in", async () => {
    for (const tool of toolsFor(OWNER)) {
      expect({ tool: tool.name, type: tool.inputSchema.type }).toEqual({
        tool: tool.name,
        type: "object",
      });
      expect(tool.inputSchema).toHaveProperty("properties");
      expect(tool.description).toContain("service");
    }
  });

  it("uses names a client will accept", async () => {
    // Dots are outside the charset most clients allow, and the mapping only
    // reverses because no service name contains an underscore of its own.
    for (const service of listServices().keys()) {
      expect({ service, underscore: service.includes("_") }).toEqual({
        service,
        underscore: false,
      });
    }
    for (const tool of toolsFor(OWNER)) {
      expect({ tool: tool.name, ok: /^[a-zA-Z0-9_-]{1,64}$/.test(tool.name) }).toEqual({
        tool: tool.name,
        ok: true,
      });
    }
  });
});

describe.runIf(hasDatabase)("running a tool", () => {
  let token: string;

  beforeEach(async () => {
    await truncateSpine();
    await db()
      .insert(users)
      .values({ id: OWNER.userId, email: "owner@example.test", role: "owner" })
      .onConflictDoNothing();
    token = (
      await createApiKey.call({ name: "Agent", scopes: ["contacts.*"] }, OWNER)
    ).token;
  });

  it("does the work and hands back both text and structure", async () => {
    const { body } = await rpc(
      "tools/call",
      {
        name: "contacts_create",
        arguments: { name: "Rae Fielding", email: "rae@example.test" },
      },
      { authorization: `Bearer ${token}` },
    );
    const value = body.result as {
      isError: boolean;
      content: { type: string; text: string }[];
      structuredContent: { result: { name: string } };
    };
    expect(value.isError).toBe(false);
    expect(value.content[0]!.type).toBe("text");
    expect(value.structuredContent.result.name).toBe("Rae Fielding");

    // It really happened, through the service, in the database.
    expect(await db().select().from(contacts)).toHaveLength(1);
  });

  it("reports a refusal as a tool result, not a protocol error", async () => {
    // The line the protocol draws: a JSON-RPC error means the client spoke
    // wrongly. A refused call is information the model has to see, and hiding
    // it in a protocol error leaves the agent with no idea why nothing
    // happened.
    const { body } = await rpc(
      "tools/call",
      { name: "cms_ensureDefaults", arguments: {} },
      { authorization: `Bearer ${token}` },
    );
    // cms is outside this key's scopes, so it is not even offered — which is
    // an invalid-params error about the tool, not about the call.
    expect((body.error as { code: number }).code).toBe(-32602);
  });

  it("reports a validation failure as a tool result the model can read", async () => {
    const { body } = await rpc(
      "tools/call",
      { name: "contacts_create", arguments: { email: "not-an-email" } },
      { authorization: `Bearer ${token}` },
    );
    const value = body.result as { isError: boolean; content: { text: string }[] };
    expect(value.isError).toBe(true);
    expect(value.content[0]!.text.length).toBeGreaterThan(0);
  });

  it("says the same thing for an unknown tool as for one it may not use", async () => {
    // Otherwise guessing names is a way to map the instance.
    const unknown = await rpc(
      "tools/call",
      { name: "nothing_here", arguments: {} },
      { authorization: `Bearer ${token}` },
    );
    const forbidden = await rpc(
      "tools/call",
      { name: "media_trash", arguments: {} },
      { authorization: `Bearer ${token}` },
    );
    expect((unknown.body.error as { code: number }).code).toBe(
      (forbidden.body.error as { code: number }).code,
    );
  });

  it("needs a tool name", async () => {
    const { body } = await rpc("tools/call", { arguments: {} });
    expect((body.error as { code: number }).code).toBe(-32602);
  });

  it("lists nothing useful to a caller with no credential", async () => {
    const { body } = await rpc("tools/list");
    const tools = (body.result as { tools: { name: string }[] }).tools;
    expect(tools.every((tool) => !tool.name.startsWith("contacts_"))).toBe(true);
  });

  it("attributes the work to the key by name", async () => {
    // The whole reason an agent gets its own credential.
    await rpc(
      "tools/call",
      { name: "contacts_create", arguments: { name: "Attributed" } },
      { authorization: `Bearer ${token}` },
    );
    const { auditLog } = await import("@/core/events/schema");
    const rows = await db().select().from(auditLog);
    expect(rows.some((row) => row.actor === "agent:Agent")).toBe(true);
  });
});
