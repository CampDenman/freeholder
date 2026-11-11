// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.41: plugin HTTP uses the core address-pinned boundary, never bare fetch.
import { readBoundedBytes } from "@/core/http/body";
import { getPinnedBytes, requestPinnedBytes } from "@/core/http/pinned-download";
import { ServiceError } from "@/core/service";

type NetworkManifest = { name: string; permissions: readonly string[] };
const METHODS = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]);
const HOP_HEADERS = new Set(["host", "connection", "content-length", "transfer-encoding", "upgrade", "keep-alive", "te", "trailer", "proxy-authorization", "proxy-connection"]);

/** Bind once to the plugin's own manifest. This is not a JavaScript sandbox. */
export function createPluginHttp(
  manifest: NetworkManifest,
  transport: typeof requestPinnedBytes = requestPinnedBytes,
  downloadTransport: typeof getPinnedBytes = getPinnedBytes,
) {
  const name = manifest.name;
  const external = manifest.permissions.includes("network:external");
  function requireExternal(): void {
    if (!external) throw new ServiceError("permission", `Plugin ${name} does not declare network:external.`);
  }
  const pluginFetch: typeof fetch = async (input, init) => {
    requireExternal();
    const request = new Request(input, init);
    if (!METHODS.has(request.method)) throw new ServiceError("validation", "That plugin HTTP method is not supported.");
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(20_000)]);
    const body = request.body ? await readBoundedBytes(request, 1024 * 1024, signal) : undefined;
    const headers: Record<string, string> = {};
    for (const [key, value] of request.headers) {
      if (!HOP_HEADERS.has(key) && !key.startsWith("proxy-")) headers[key] = value;
    }
    headers["accept-encoding"] = "identity";
    if (body) headers["content-length"] = String(body.byteLength);
    const response = await transport(request.url, {
      method: request.method as NonNullable<Parameters<typeof requestPinnedBytes>[1]["method"]>,
      body, headers, signal, allowLocal: false, timeoutMs: 20_000, dnsTimeoutMs: 5_000,
      maxBytes: 2 * 1024 * 1024,
    });
    if (response.status >= 300 && response.status < 400) throw new ServiceError("permission", "Plugin HTTP redirects are refused.");
    if (response.headers.has("content-encoding") && response.headers.get("content-encoding") !== "identity") throw new ServiceError("validation", "Plugin HTTP requires an uncompressed response.");
    const noBody = request.method === "HEAD" || [204, 205, 304].includes(response.status);
    return new Response(noBody ? null : response.bytes, { status: response.status, headers: response.headers });
  };
  const download: typeof getPinnedBytes = async (raw, options) => {
    requireExternal();
    const response = await downloadTransport(raw, { ...options, maxBytes: Math.min(options.maxBytes, 512 * 1024 * 1024), allowLocal: false, timeoutMs: Math.min(options.timeoutMs ?? 30_000, 60_000), dnsTimeoutMs: 5_000 });
    if (response.status >= 300 && response.status < 400) throw new ServiceError("permission", "Plugin HTTP redirects are refused.");
    return response;
  };
  return { fetch: pluginFetch, download };
}
