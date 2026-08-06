// Copyright (C) 2026 Camp Denman Society
// SPDX-License-Identifier: AGPL-3.0-only
// This instance as an MCP server (MASTER.md §28.3, §28.4).
//
// "An AI agent connected to any instance discovers its exact live capabilities
// — including plugins installed yesterday — through MCP introspection." That
// is this route: point an agent here with an API key and it learns what this
// business can do from the registry, not from documentation about Freeholder
// in general.
import { handleMcp } from "@/mcp/server";
import { currentBusiness } from "@/core/settings/read";
import { version } from "@/../package.json";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const business = await currentBusiness();
  return handleMcp(request, {
    name: business?.name ?? "Freeholder",
    version,
  });
}

/**
 * The transport allows a GET that opens a server-to-client SSE stream. This
 * server never initiates anything, so it says so rather than holding a socket
 * open that will never carry a message.
 */
export function GET(): Response {
  return Response.json(
    {
      jsonrpc: "2.0",
      id: null,
      error: {
        code: -32601,
        message:
          "This MCP server does not stream. POST JSON-RPC requests to this address instead.",
      },
    },
    { status: 405, headers: { allow: "POST" } },
  );
}
