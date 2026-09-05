// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// MCP tools, derived from the service registry (MASTER.md §11, §28.3).
//
// §28 is emphatic about why this is generated rather than authored: "New
// feature merged → new MCP tool exists. No release lag at all." An instance
// with a plugin installed an hour ago exposes that plugin's tools to an agent
// now, with descriptions from the plugin's own schema — because there is no
// second list anywhere that someone would have to remember to update.
//
// Two things are decided here that the HTTP API did not have to decide.
//
// **Which tools a caller sees.** The list is filtered by what the caller may
// actually call. An agent shown eighty tools and permitted six will spend its
// attempts discovering that by failing, and every failure is a request that
// did something visible in an audit log for no reason. Capability discovery is
// what MCP is for, so the list *is* the capability.
//
// **What is not a tool at all.** Credential services are excluded whatever the
// caller's scopes say — see EXCLUDED_FAMILIES.
import { z } from "zod";
import { listServices, permits, type Actor, type Service } from "@/core/service";

/**
 * Families that never become tools.
 *
 * Not a security control — scopes are that, and `apikeys.create` already
 * refuses an agent outright. This is about what an agent should be *invited*
 * to do. `auth.login` is a public service, so it would appear to an
 * unauthenticated MCP client as a tool taking an email and a password, which
 * is an invitation to guess at credentials rather than a capability of the
 * business. An agent authenticates with the key it was given; managing
 * credentials is the owner's work, done while signed in.
 * Staff invitations are the same boundary: accepting one chooses a password,
 * while creating or resending one issues a credential that can create an
 * account. They stay available through the human UI and HTTP service surface,
 * but an MCP client is never prompted to handle either side of that secret.
 *
 * Families that stay off MCP unless a service sets `mcpExclude: false`.
 * Per-service `mcpExclude` is the C3.04 opt-out.
 */
const EXCLUDED_FAMILIES = new Set(["auth", "apikeys", "invitations"]);

export function hiddenFromMcp(service: Service): boolean {
  // Internal orchestration never becomes an agent capability. This check is
  // first so `mcpExclude: false` cannot accidentally override the boundary.
  if (service.def.permission === "system" || service.def.external === false) return true;
  if (service.def.mcpExclude === true) return true;
  if (service.def.mcpExclude === false) return false;
  return EXCLUDED_FAMILIES.has(service.def.name.split(".")[0]!);
}

export interface McpTool {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: {
    readOnlyHint: boolean;
    destructiveHint: boolean;
    idempotentHint: boolean;
    /** C3.04: who this listing was computed for. */
    actorKind: Actor["kind"];
    /** C3.04: a person must confirm before the service will run. */
    approval: "none" | "step_up" | "human";
  };
}

/**
 * `contacts.create` → `contacts_create`.
 *
 * MCP tool names are restricted to letters, digits, underscore and hyphen by
 * most clients, and every service name in this codebase is `[a-z]` plus dots
 * with no underscores of its own — asserted in the tests — so swapping the
 * separator is unambiguous and reverses exactly.
 */
export function toolName(serviceName: string): string {
  return serviceName.replace(/\./g, "_");
}

/** Verbs that destroy something a person would miss. */
const DESTRUCTIVE = /^(delete|remove|revoke|purge|trash|merge)/;

function describe(service: Service): string {
  const { name, summary, permission, kind } = service.def;
  const family = `${name.split(".")[0]!}.*`;
  return [
    summary,
    "",
    `Calls the \`${name}\` service. ${kind === "query" ? "Reads only." : "Changes data."}`,
    permission === "public"
      ? "Available to any caller."
      : permission === "authenticated"
        ? "Available only to a signed-in person."
        : `Needs an API key scoped \`${name}\` or \`${family}\`.`,
  ].join("\n");
}

/**
 * A service's input as JSON Schema, for the tool's `inputSchema`.
 *
 * The same generation the OpenAPI document uses, and the same reason: it is
 * the object the call will actually be validated against, so a tool cannot
 * advertise a shape the service would reject.
 */
function inputSchema(service: Service): Record<string, unknown> {
  let schema: Record<string, unknown>;
  try {
    schema = z.toJSONSchema(service.def.input, { io: "input" });
  } catch {
    schema = { type: "object" };
  }
  delete schema.$schema;
  // MCP requires an object schema at the top level. A service whose input is
  // not an object (none are today) would otherwise produce a tool no client
  // can call.
  if (schema.type !== "object") return { type: "object", properties: {} };
  return { properties: {}, ...schema };
}

/**
 * Every tool this caller may use.
 *
 * `permits` is the same function the service itself will consult, so the list
 * cannot promise something the call would refuse.
 */
export function toolsFor(actor: Actor): McpTool[] {
  const tools: McpTool[] = [];
  for (const service of listServices().values()) {
    const { name, kind, permission, summary } = service.def;
    if (hiddenFromMcp(service)) continue;
    if (service.def.stepUp && actor.kind !== "user") continue;
    if (service.def.agentCallable === false && actor.kind === "agent") continue;
    if (!permits(actor, permission, name, kind)) continue;

    const verb = name.split(".")[1] ?? "";
    tools.push({
      name: toolName(name),
      title: summary,
      description: describe(service),
      inputSchema: inputSchema(service),
      annotations: {
        // Hints, not enforcement — the service is the enforcement. They let a
        // client decide what to confirm with a person before running.
        readOnlyHint: kind === "query",
        destructiveHint: kind === "mutation" && DESTRUCTIVE.test(verb),
        idempotentHint: kind === "query",
        actorKind: actor.kind,
        approval: service.def.stepUp
          ? "step_up"
          : service.def.agentCallable === false
            ? "human"
            : "none",
      },
    });
  }
  return tools.sort((a, b) => a.name.localeCompare(b.name));
}

/** The service behind a tool name, if this caller may call it. */
export function serviceForTool(
  actor: Actor,
  tool: string,
): Service | undefined {
  for (const service of listServices().values()) {
    if (toolName(service.def.name) !== tool) continue;
    if (hiddenFromMcp(service)) return undefined;
    if (service.def.stepUp && actor.kind !== "user") return undefined;
    if (service.def.agentCallable === false && actor.kind === "agent") {
      return undefined;
    }
    // Resolved through the same permission check as the listing, so a tool
    // that was never offered cannot be called by guessing its name.
    if (
      !permits(
        actor,
        service.def.permission,
        service.def.name,
        service.def.kind,
      )
    )
      return undefined;
    return service;
  }
  return undefined;
}
