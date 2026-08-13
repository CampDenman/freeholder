// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The MCP endpoint (MASTER.md §11, §28.3, §28.4).
//
// MCP is JSON-RPC 2.0 over the Streamable HTTP transport. For a server that
// exposes tools and nothing else, that reduces to: accept a POST, answer with
// a single JSON object. There is no session to keep, nothing the server pushes
// unprompted, and therefore no SSE stream — the transport permits a plain
// `application/json` response and this takes it.
//
// **Written directly rather than on the official SDK.** The same reasoning that
// kept `zod-openapi` out: the SDK's transports are built around Node's http
// streams, and Next hands routes a web-standard `Request`, so adopting it here
// would mean maintaining an adapter between the two — a piece of glue with its
// own failure modes, in exchange for protocol code that is this short. What is
// *not* implemented is stated below rather than implied.
//
// Not implemented, deliberately:
//   - SSE / server-initiated messages. Nothing here streams or notifies.
//   - `resources` and `prompts`. Freeholder's capabilities are verbs, and the
//     nouns are already reachable through the query tools.
//   - Sessions (`Mcp-Session-Id`). Every request carries its own credential
//     and is answered on its own; there is no state to resume.
//
// Each of those is additive under the protocol, so a client that wants them
// negotiates and finds them absent rather than breaking.
import { actorFromRequest } from "@/core/http/actor";
import { ready } from "@/core/runtime";
import { ServiceError, type Actor } from "@/core/service";
import { serviceForTool, toolsFor } from "@/mcp/tools";

/** The revision this implements. Echoed back when a client asks for it. */
export const PROTOCOL_VERSION = "2025-06-18";
const SUPPORTED = new Set([PROTOCOL_VERSION, "2025-03-26", "2024-11-05"]);

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

/** JSON-RPC's own codes. Tool *failures* are not these — see callTool. */
const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;

function result(id: JsonRpcRequest["id"], value: unknown): unknown {
  return { jsonrpc: "2.0", id: id ?? null, result: value };
}

function failure(
  id: JsonRpcRequest["id"],
  code: number,
  message: string,
): unknown {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

export interface McpServerInfo {
  name: string;
  version: string;
}

function initialize(
  request: JsonRpcRequest,
  info: McpServerInfo,
): unknown {
  const asked = (request.params?.protocolVersion as string | undefined) ?? "";
  // Answer in the client's dialect when it is one we speak, otherwise name
  // ours and let the client decide — which is what the negotiation is for.
  const version = SUPPORTED.has(asked) ? asked : PROTOCOL_VERSION;
  return result(request.id, {
    protocolVersion: version,
    capabilities: {
      // `listChanged` is false: the tool list is derived per request from the
      // registry and the caller's scopes, so there is no change to announce —
      // a client that asks again gets the current answer.
      tools: { listChanged: false },
    },
    serverInfo: info,
    instructions: [
      `${info.name} exposes this business's own platform as tools.`,
      "Every tool is a service call: the same validation, permissions and audit trail as the owner's admin screens.",
      "Tools whose names read as queries only read. Anything that changes data is recorded against your API key by name.",
    ].join(" "),
  });
}

/**
 * Run a tool.
 *
 * A service that refuses or fails comes back as a tool *result* with
 * `isError: true`, not as a JSON-RPC error. The protocol draws that line
 * deliberately: a JSON-RPC error means the client spoke wrongly, while a
 * failed call is information the model needs to see and reason about. Handing
 * a permission refusal back as a protocol error hides it from the agent, which
 * then has no idea why nothing happened.
 */
async function callTool(
  request: JsonRpcRequest,
  actor: Actor,
): Promise<unknown> {
  const name = request.params?.name;
  if (typeof name !== "string") {
    return failure(request.id, INVALID_PARAMS, "A tool name is required.");
  }

  const service = serviceForTool(actor, name);
  if (!service) {
    // Unknown and not-permitted answer identically, so the tool list stays the
    // only way to learn what exists — guessing names reveals nothing.
    return failure(
      request.id,
      INVALID_PARAMS,
      `No tool called "${name}" is available to you. Call tools/list to see what is.`,
    );
  }

  const args = request.params?.arguments ?? {};
  try {
    const value = await service.call(args, actor);
    return result(request.id, {
      content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
      // The same data again, structured, for clients that can use it without
      // parsing the text back out.
      structuredContent: { result: value },
      isError: false,
    });
  } catch (error) {
    const message =
      error instanceof ServiceError
        ? error.message
        : "Something went wrong running that tool.";
    if (!(error instanceof ServiceError)) {
      // A non-ServiceError can carry a query or a connection string; it goes to
      // the log, never to the caller.
      console.error(`[mcp] ${service.def.name} failed`, error);
    }
    return result(request.id, {
      content: [{ type: "text", text: message }],
      isError: true,
    });
  }
}

async function handleOne(
  request: JsonRpcRequest,
  actor: Actor,
  info: McpServerInfo,
): Promise<unknown> {
  if (request.jsonrpc !== "2.0" || typeof request.method !== "string") {
    return failure(request.id, INVALID_REQUEST, "Not a JSON-RPC 2.0 request.");
  }

  switch (request.method) {
    case "initialize":
      return initialize(request, info);
    case "ping":
      return result(request.id, {});
    case "tools/list":
      // No cursor: the list is short enough that paginating it would be
      // ceremony, and `nextCursor` is optional precisely for this case.
      return result(request.id, { tools: toolsFor(actor) });
    case "tools/call":
      return callTool(request, actor);
    default:
      if (request.method.startsWith("notifications/")) {
        // A notification has no id and takes no response. `initialized` is the
        // one every client sends after the handshake.
        return undefined;
      }
      return failure(
        request.id,
        METHOD_NOT_FOUND,
        `This server does not implement ${request.method}. It offers tools only.`,
      );
  }
}

/**
 * The whole endpoint.
 *
 * Boot first, for the same reason the HTTP API does: this reaches the registry
 * before any service call would, and an unbooted registry is an empty one — an
 * agent would be told this instance can do nothing at all.
 */
export async function handleMcp(
  request: Request,
  info: McpServerInfo,
): Promise<Response> {
  await ready();
  const actor = await actorFromRequest(request);

  let body: unknown;
  try {
    body = (await request.json()) as unknown;
  } catch {
    return Response.json(failure(null, PARSE_ERROR, "Body is not JSON."), {
      status: 400,
    });
  }

  // Batches were part of the protocol before the 2025-06-18 revision removed
  // them. Answering one is a few lines and lets an older client work.
  if (Array.isArray(body)) {
    const responses = (
      await Promise.all(
        body.map((entry) => handleOne(entry as JsonRpcRequest, actor, info)),
      )
    ).filter((entry) => entry !== undefined);
    // A batch of nothing but notifications gets no body, per JSON-RPC.
    return responses.length === 0
      ? new Response(null, { status: 202 })
      : Response.json(responses);
  }

  const response = await handleOne(body as JsonRpcRequest, actor, info);
  // A notification produces no response at all — undefined here means "say
  // nothing", which JSON-RPC requires and clients rely on when matching
  // responses back to the requests they sent.
  if (response === undefined) return new Response(null, { status: 202 });
  return Response.json(response);
}
