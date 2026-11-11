// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { createServer, type Server, type RequestListener } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPluginHttp } from "@/core/plugins/fetch";
import { requestPinnedBytes, type getPinnedBytes } from "@/core/http/pinned-download";
import { readBoundedBytes } from "@/core/http/body";
import { defineOrchestratedService } from "@/core/service";
import { z } from "zod";
import { pluginHttp as voiceHttp } from "../../plugins/voice-video/http";
import { pluginHttp as printHttp } from "../../plugins/print-on-demand/http";
import { pluginHttp as marketHttp } from "../../plugins/marketplace/http";
import { createParadiseClient } from "../../plugins/voice-video/paradise";
import { createDailyClient } from "../../plugins/voice-video/daily";
import { createPrintifyClient } from "../../plugins/print-on-demand/printify";
import { createShopifyProvider } from "../../plugins/marketplace/shopify";

const declared = { name: "network-fixture", permissions: ["network:external"] };
const reply = (status = 200) => ({ status, contentType: "application/json", bytes: new TextEncoder().encode('{"ok":true}'), headers: new Headers({ "content-type": "application/json" }) });
const servers: Server[] = [];
async function listen(handler: RequestListener): Promise<string> {
  const server = createServer(handler); servers.push(server);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No fixture listener");
  return `http://127.0.0.1:${address.port}`;
}
afterEach(async () => {
  vi.restoreAllMocks(); vi.unstubAllGlobals();
  await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve, reject) => {
    server.closeAllConnections(); server.close(error => error ? reject(error) : resolve());
  })));
});

describe("plugin HTTP capabilities (C3.41)", () => {
  it("uses the scoped defaults in every production provider instead of global fetch", async () => {
    const unscoped = vi.fn<typeof fetch>().mockRejectedValue(new Error("Unscoped network forbidden"));
    vi.stubGlobal("fetch", unscoped);
    const voice = vi.spyOn(voiceHttp, "fetch").mockResolvedValueOnce(Response.json({ rooms: [] })).mockResolvedValueOnce(Response.json({ domain_name: "fixture" }));
    await createParadiseClient({ baseUrl: "https://provider.example", authScheme: "site_key", apiKey: "fixture", portfolioToken: null }).verifyConnection();
    await createDailyClient({ apiKey: "fixture", domain: "fixture.daily.co" }).verifyDomain();
    expect(voice).toHaveBeenCalledTimes(2);
    const print = vi.spyOn(printHttp, "fetch").mockResolvedValue(Response.json({ id: "provider-order", status: "fulfilled", metadata: { shop_order_id: "our-job" }, shipments: [] }));
    await createPrintifyClient({ token: "fixture", shopId: "123" }).getOrder("provider-order", "our-job");
    expect(print).toHaveBeenCalledOnce();
    const market = vi.spyOn(marketHttp, "fetch")
      .mockResolvedValueOnce(Response.json({ access_token: "fixture", expires_in: 3600, scope: "read_orders,read_customers" }))
      .mockResolvedValueOnce(Response.json({ data: { shop: { id: "gid://shopify/Shop/123", myshopifyDomain: "fixture.myshopify.com" }, currentAppInstallation: { accessScopes: [{ handle: "read_orders" }, { handle: "read_customers" }] } } }));
    await createShopifyProvider({ shop: "fixture.myshopify.com", clientId: "fixture", clientSecret: "fixture" }).connect({ name: "Fixture", provider: "shopify" });
    expect(market).toHaveBeenCalledTimes(2); expect(unscoped).not.toHaveBeenCalled();
  });

  it("refuses fetch and downloads without the scope before any transport runs", async () => {
    const transport = vi.fn<typeof requestPinnedBytes>().mockResolvedValue(reply());
    const download = vi.fn<typeof getPinnedBytes>().mockResolvedValue(reply());
    const plugin = createPluginHttp({ name: "no-network", permissions: ["contacts:read"] }, transport, download);
    await expect(plugin.fetch("https://provider.example/api")).rejects.toMatchObject({ code: "permission" });
    await expect(plugin.download("https://provider.example/file", { maxBytes: 100 })).rejects.toMatchObject({ code: "permission" });
    expect(transport).not.toHaveBeenCalled(); expect(download).not.toHaveBeenCalled();
  });

  it("snapshots its own manifest rather than accepting changed per-request grants", async () => {
    const manifest = { name: "ungranted", permissions: [] as string[] };
    const transport = vi.fn<typeof requestPinnedBytes>().mockResolvedValue(reply());
    const plugin = createPluginHttp(manifest, transport);
    manifest.permissions.push("network:external");
    await expect(plugin.fetch("https://provider.example/api")).rejects.toMatchObject({ code: "permission" });
    expect(transport).not.toHaveBeenCalled();
  });

  it("bounds and pins every declared request, preserving the API method and response headers", async () => {
    const transport = vi.fn<typeof requestPinnedBytes>().mockResolvedValue({ ...reply(), headers: new Headers({ "content-type": "application/json", "x-request-id": "fixture-1" }) });
    const plugin = createPluginHttp(declared, transport);
    const response = await plugin.fetch("https://provider.example/api", { method: "PATCH", headers: { host: "127.0.0.1", authorization: "Bearer fixture", "proxy-authorization": "remove", connection: "keep-alive" }, body: '{"test":true}' });
    expect(await response.json()).toEqual({ ok: true });
    expect(response.headers.get("x-request-id")).toBe("fixture-1");
    const [url, options] = transport.mock.calls[0]!;
    expect(url).toBe("https://provider.example/api");
    expect(options).toMatchObject({ method: "PATCH", allowLocal: false, timeoutMs: 20_000, dnsTimeoutMs: 5_000, maxBytes: 2 * 1024 * 1024 });
    expect(options.headers).toEqual({ authorization: "Bearer fixture", "content-type": "text/plain;charset=UTF-8", "content-length": "13", "accept-encoding": "identity" });
    expect(new TextDecoder().decode(options.body)).toBe('{"test":true}');
  });

  it("refuses redirect responses rather than forwarding credentials", async () => {
    const transport = vi.fn<typeof requestPinnedBytes>().mockResolvedValue({ ...reply(302), headers: new Headers({ location: "http://169.254.169.254" }) });
    const plugin = createPluginHttp(declared, transport);
    await expect(plugin.fetch("https://provider.example/api", { redirect: "follow" })).rejects.toMatchObject({ code: "permission" });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("rejects oversized bodies before network I/O and cancels hanging body reads", async () => {
    const transport = vi.fn<typeof requestPinnedBytes>().mockResolvedValue(reply());
    const plugin = createPluginHttp(declared, transport);
    await expect(plugin.fetch("https://provider.example/api", { method: "POST", body: "x".repeat(1024 * 1024 + 1) })).rejects.toMatchObject({ status: 413 });
    const controller = new AbortController(); const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array<ArrayBuffer>>({ cancel });
    const pending = readBoundedBytes({ body, headers: new Headers() }, 100, controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(cancel).toHaveBeenCalledOnce(); expect(transport).not.toHaveBeenCalled();
  });

  it("preserves body-free API responses", async () => {
    const transport = vi.fn<typeof requestPinnedBytes>().mockResolvedValue(reply(204));
    const response = await createPluginHttp(declared, transport).fetch("https://provider.example/api", { method: "DELETE" });
    expect(response.status).toBe(204); expect(await response.text()).toBe("");
  });

  it("forces private-address refusal and caps recording downloads even if callers request otherwise", async () => {
    const download = vi.fn<typeof getPinnedBytes>().mockResolvedValue(reply());
    await createPluginHttp(declared, undefined, download).download("https://provider.example/recording", { maxBytes: 1024 ** 3, timeoutMs: 120_000, allowLocal: true, dnsTimeoutMs: 120_000 });
    expect(download.mock.calls[0]![1]).toMatchObject({ allowLocal: false, maxBytes: 512 * 1024 * 1024, timeoutMs: 60_000, dnsTimeoutMs: 5_000 });
  });

  it("refuses actual private and mixed DNS answers before connecting", async () => {
    const privateHttp = createPluginHttp(declared);
    await expect(privateHttp.fetch("http://127.0.0.1/private")).rejects.toThrow(/public|https|local|prohibited/i);
    const mixed = vi.fn(async () => [{ address: "93.184.216.34", family: 4 as const }, { address: "127.0.0.1", family: 4 as const }]);
    const transport: typeof requestPinnedBytes = (url, options) => requestPinnedBytes(url, { ...options, lookup: mixed });
    await expect(createPluginHttp(declared, transport).fetch("https://provider.example/api")).rejects.toThrow(/prohibited/);
    expect(mixed).toHaveBeenCalledOnce();
  });

  it("carries declared and refused plugin requests through the shared service boundary", async () => {
    const transport = vi.fn<typeof requestPinnedBytes>().mockResolvedValue(reply());
    const probe = (permissions: string[]) => defineOrchestratedService({
      name: "networkFixture.probe", summary: "Exercise the plugin HTTP boundary.", kind: "query", permission: "public",
      input: z.object({}), output: z.object({ ok: z.boolean() }),
      handler: async () => ({ ok: (await createPluginHttp({ name: "network-fixture", permissions }, transport).fetch("https://provider.example/api")).ok }),
    });
    await expect(probe([]).call({}, { kind: "anonymous" })).rejects.toMatchObject({ code: "permission" });
    expect(transport).not.toHaveBeenCalled();
    expect(await probe(["network:external"]).call({}, { kind: "anonymous" })).toEqual({ ok: true });
    expect(transport).toHaveBeenCalledOnce();
  });
});

describe("core pinned request connection (C3.41)", () => {
  it("sends real method/body bytes on a pinned local fixture", async () => {
    let received = "";
    const url = await listen((request, response) => {
      request.on("data", (chunk: Buffer) => { received += chunk.toString(); });
      request.on("end", () => { response.setHeader("x-method", request.method!); response.end(received); });
    });
    // Only this core transport test allows its loopback fixture; the plugin
    // wrapper always passes allowLocal:false, verified above.
    const response = await requestPinnedBytes(url, { method: "PUT", body: new TextEncoder().encode("fixture-body"), allowLocal: true, maxBytes: 100 });
    expect(response.headers.get("x-method")).toBe("PUT");
    expect(new TextDecoder().decode(response.bytes)).toBe("fixture-body");
  });

  it("returns a redirect without making a second request", async () => {
    let requests = 0;
    const url = await listen((_request, response) => { requests++; response.writeHead(302, { location: "/private" }); response.end(); });
    const response = await requestPinnedBytes(url, { allowLocal: true, maxBytes: 100 });
    expect(response.status).toBe(302); expect(requests).toBe(1);
  });

  it("enforces declared and streamed response limits, a deadline and caller cancellation", async () => {
    const oversized = await listen((_request, response) => { response.writeHead(200, { "content-length": "1000" }); response.end("large"); });
    await expect(requestPinnedBytes(oversized, { allowLocal: true, maxBytes: 10 })).rejects.toMatchObject({ code: "too_large" });
    const streamed = await listen((_request, response) => { response.write("x".repeat(30)); response.end(); });
    await expect(requestPinnedBytes(streamed, { allowLocal: true, maxBytes: 10 })).rejects.toMatchObject({ code: "too_large" });
    const stalled = await listen((_request, response) => { response.writeHead(200); response.flushHeaders(); });
    await expect(requestPinnedBytes(stalled, { allowLocal: true, maxBytes: 10, timeoutMs: 30 })).rejects.toMatchObject({ code: "timeout" });
    let connected!: () => void;
    const accepted = new Promise<void>(resolve => { connected = resolve; });
    const cancellable = await listen((_request, response) => { response.writeHead(200); response.flushHeaders(); connected(); });
    const controller = new AbortController();
    const pending = requestPinnedBytes(cancellable, { allowLocal: true, maxBytes: 10, signal: controller.signal });
    await accepted;
    controller.abort();
    await expect(pending).rejects.toThrow();
  });
});
