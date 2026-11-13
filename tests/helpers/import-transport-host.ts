// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C3.22/C3.47/F05: owned TCP ingress into the actual application route handlers.
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { z } from "zod";
import { GET as apiGet, POST as apiPost } from "../../app/api/v1/[service]/route";
import { POST as mcpPost } from "../../app/api/mcp/route";
import { POST as chunkPost } from "../../app/api/imports/source/chunk/route";
import { GET as openApiGet } from "../../app/api/openapi.json/route";
import { CSRF_HEADER } from "@/core/http/csrf";
import { PROTOCOL_VERSION } from "@/mcp/server";

const rpcEnvelope = z.object({ jsonrpc: z.literal("2.0"), id: z.number(), error: z.object({ code: z.number(), message: z.string() }).optional(), result: z.unknown().optional() });
const toolResult = z.object({ isError: z.boolean().optional(), content: z.array(z.object({ type: z.string(), text: z.string().optional() })).optional(), structuredContent: z.object({ result: z.unknown() }).optional() });
export type SyntheticOwnerSession = { cookie: string; csrf: string };

/** A test host supplies only Node Request/Response adaptation. It never
 * resolves actors, invokes services, rewrites permissions or mocks auth. */
export async function importTransportHost() {
  const requests: Array<{ method: string; path: string }> = [], failures: Error[] = [];
  let origin = "";
  const server: Server = createServer((incoming, outgoing) => {
    void (async () => {
      const method = incoming.method ?? "GET", url = new URL(incoming.url ?? "/", origin);
      requests.push({ method, path: url.pathname });
      const headers = new Headers();
      for (const [name, value] of Object.entries(incoming.headers)) {
        if (Array.isArray(value)) for (const part of value) headers.append(name, part);
        else if (value !== undefined) headers.set(name, value);
      }
      const chunks: Buffer[] = []; let size = 0;
      for await (const chunk of incoming) {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); size += bytes.byteLength;
        if (size > 4 * 1024 * 1024 + 65_536) { outgoing.writeHead(413); outgoing.end(); return; }
        chunks.push(bytes);
      }
      const request = new Request(url, { method, headers, ...(method === "GET" || method === "HEAD" ? {} : { body: new Uint8Array(Buffer.concat(chunks)).buffer }) });
      let response: Response;
      if (url.pathname === "/api/mcp" && method === "POST") response = await mcpPost(request);
      else if (url.pathname === "/api/imports/source/chunk" && method === "POST") response = await chunkPost(request);
      else if (url.pathname === "/api/openapi.json" && method === "GET") response = await openApiGet();
      else if (url.pathname.startsWith("/api/v1/") && ["GET", "POST"].includes(method)) {
        const params = { params: Promise.resolve({ service: decodeURIComponent(url.pathname.slice("/api/v1/".length)) }) };
        response = method === "GET" ? await apiGet(request, params) : await apiPost(request, params);
      } else response = new Response(null, { status: 404 });
      outgoing.statusCode = response.status;
      for (const [name, value] of response.headers) outgoing.setHeader(name, value);
      outgoing.end(Buffer.from(await response.arrayBuffer()));
    })().catch((cause: unknown) => {
      failures.push(cause instanceof Error ? cause : new Error("Synthetic TCP host failure", { cause }));
      if (!outgoing.headersSent) outgoing.writeHead(500, { "content-type": "application/json" });
      outgoing.end(JSON.stringify({ error: { code: "test_host", message: "The synthetic TCP host failed." } }));
    });
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    origin, requests, failures,
    async close() {
      server.closeIdleConnections();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    },
  };
}

export function authenticatedJson(token: string) { return { "content-type": "application/json", authorization: `Bearer ${token}` }; }
export async function humanHttp(origin: string, session: SyntheticOwnerSession, service: string, input: unknown) {
  return fetch(`${origin}/api/v1/${service}`, { method: "POST", headers: { "content-type": "application/json", cookie: session.cookie, [CSRF_HEADER]: session.csrf }, body: JSON.stringify(input) });
}
export async function issueTransportKey(origin: string, session: SyntheticOwnerSession, name: string, scopes: string[]) {
  const response = await humanHttp(origin, session, "apikeys.create", { name, scopes, expiresInDays: 1 });
  if (response.status !== 200) throw new Error(`Real freshly verified owner key issuance refused: HTTP${response.status}`);
  return z.object({ id: z.uuid(), name: z.string(), token: z.string().startsWith("fh_live_"), scopes: z.array(z.string()) }).parse(await response.json());
}

/** Actual JSON-RPC over native fetch/TCP; this is not an official third-party
 * MCP client interoperability claim. No service handler is called here. */
export function importMcpClient(origin: string, token: string) {
  let nextId = 0;
  async function rpc(method: string, params: Record<string, unknown> = {}) {
    const id = ++nextId, response = await fetch(`${origin}/api/mcp`, { method: "POST", headers: authenticatedJson(token), body: JSON.stringify({ jsonrpc: "2.0", id, method, params }) });
    if (response.status !== 200) throw new Error(`MCP transport HTTP${response.status}`);
    const envelope = rpcEnvelope.parse(await response.json());
    if (envelope.id !== id) throw new Error("MCP response did not retain the actual client request ID.");
    return envelope;
  }
  return {
    rpc,
    async initialize() { return rpc("initialize", { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "fictional-import-transport-client", version: "1" } }); },
    async tool<T extends z.ZodType>(name: string, input: unknown, schema: T): Promise<z.output<T>> {
      const envelope = await rpc("tools/call", { name, arguments: input });
      if (envelope.error) throw new Error(`MCP protocol refusal: ${envelope.error.code}`);
      const result = toolResult.parse(envelope.result);
      if (result.isError || !result.structuredContent) throw new Error(result.content?.find(block => block.type === "text")?.text ?? "MCP tool refused.");
      return schema.parse(result.structuredContent.result);
    },
  };
}
