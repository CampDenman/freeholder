// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// PREPARED / UNRUN. Real TCP fictional provider + private-delivery adapter.
// This is NOT a real SSH/account/claim/owner-init acceptance. No ABI is enabled.
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { describe, expect, it } from "vitest";
import { parseLaunchArgs } from "../../packages/cli/src/launch/args";
import { digitalOcean } from "../../packages/cli/src/launch/digitalocean";
import { runLaunch } from "../../packages/cli/src/launch/launch";
import { isPinned } from "../../packages/cli/src/launch/image";
import { signS3 } from "../../packages/cli/src/launch/s3";
import type { Remote } from "../../packages/cli/src/launch/types";
import { verifyNamespaceOriginArtifacts, requireInstalledNamespaceOrigin } from "@/core/media/quota-namespace-origin";
import { storageNamespace } from "@/core/media/storage-quota";

const enabled = process.env.FREEHOLDER_TEST_NAMESPACE_ORIGIN_TCP === "1";
const publishedImage = process.env.FREEHOLDER_TEST_NAMESPACE_ORIGIN_IMAGE;
// Named prerequisite: an ACTUAL published compatible image and its real public
// gh/source verification. Never substitute a fixture profile or verifier.
describe.skipIf(!enabled || !publishedImage)("genuine fictional TCP namespace birth and bootstrap delivery [requires real compatible published image]", () => {
  it("uses the real owner-run producer and real launch delivery sequence; a copied pure receipt still cannot authorize initialization", async () => {
    if (!publishedImage || !isPinned(publishedImage)) throw new Error("Supply the actual published compatible immutable image; no fixture ABI is accepted");
    const root = await mkdtemp(join(tmpdir(), "freeholder-fictional-launch-origin-"));
    const calls: { method: string; path: string }[] = [], files = new Map<string, string>(), keys = new Map<string, string>(), buckets = new Set<string>();
    let droplet = false, backup = false, keyCount = 0, failure: Error | null = null;
    const recordedFailure = (): Error | null => failure;
    const server = createServer((request, response) => { void (async () => {
      const parts: Buffer[] = [];
      for await (const part of request) { const value: unknown = part; if (typeof value === "string") parts.push(Buffer.from(value)); else if (value instanceof Uint8Array) parts.push(Buffer.from(value)); else throw new Error("Unexpected actual TCP request body chunk"); }
      const body = Buffer.concat(parts).toString("utf8"), path = new URL(request.url ?? "/", "http://fictional.invalid"), method = request.method ?? "GET";
      calls.push({ method, path: path.pathname });
      const json = (value: unknown, status = 200) => { response.writeHead(status, { "content-type": "application/json" }); response.end(JSON.stringify(value)); };
      if (path.pathname.startsWith("/api/")) {
        if (request.headers.authorization !== "Bearer fictional-owner-provider-token") throw new Error("Actual provider API authentication missing");
        const actual = path.pathname.slice(4);
        if (actual === "/v2/account") return json({ account: { status: "active", uuid: "00000000-0000-4000-8000-000000000101" } });
        if (actual === "/v2/account/keys") return json({ ssh_keys: [{ id: 11, name: "fictional-owner", fingerprint: "fictional" }] });
        if (actual === "/v2/regions") return json({ regions: [{ slug: "nyc3", available: true, sizes: ["s-2vcpu-2gb"] }] });
        if (actual === "/v2/sizes") return json({ sizes: [{ slug: "s-2vcpu-2gb", price_monthly: 18 }] });
        if (actual === "/v2/droplets" && method === "GET") return json({ droplets: [] });
        if (actual === "/v2/droplets" && method === "POST") { droplet = true; return json({ droplet: { id: 42 } }, 202); }
        if (actual === "/v2/droplets/42") return json({ droplet: { status: "active", networks: { v4: [{ type: "public", ip_address: "203.0.113.7" }] } } });
        if (actual === "/v2/spaces/keys" && method === "POST") { const access = `FICTIONAL${++keyCount}`, secret = `fictional-secret-${keyCount}`; keys.set(access, secret); return json({ key: { access_key: access, secret_key: secret } }, 201); }
        if (actual.startsWith("/v2/spaces/keys/") && method === "DELETE") { keys.delete(actual.split("/").at(-1) ?? ""); response.writeHead(204); response.end(); return; }
      }
      if (path.pathname.startsWith("/spaces/")) {
        const actual = new URL(`https://nyc3.digitaloceanspaces.com${path.pathname.slice(7)}${path.search}`), auth = request.headers.authorization;
        if (typeof auth !== "string") throw new Error("Actual S3 authentication missing");
        // Split rather than scan. `/Credential=([^/]+)\//` is an unanchored search
        // for a literal that can recur, so the engine retries at every offset and
        // CodeQL flags it as polynomial ReDoS (js/polynomial-redos) on a header
        // it treats as uncontrolled. Splitting is linear and reads the same.
        const access = auth.split("Credential=")[1]?.split("/")[0], secret = access ? keys.get(access) : undefined, amz = request.headers["x-amz-date"];
        if (!access || !secret || typeof amz !== "string") throw new Error("Actual temporary or scoped S3 credential is not owned by the fictional account");
        const timestamp = new Date(`${amz.slice(0, 4)}-${amz.slice(4, 6)}-${amz.slice(6, 8)}T${amz.slice(9, 11)}:${amz.slice(11, 13)}:${amz.slice(13, 15)}Z`);
        const expected = signS3({ method, url: actual, body, region: "nyc3", credentials: { accessKeyId: access, secretAccessKey: secret }, now: timestamp });
        if (auth !== expected.authorization || request.headers["x-amz-content-sha256"] !== expected["x-amz-content-sha256"]) throw new Error("Actual S3 request signature/body mismatch");
        const bucket = actual.pathname.slice(1);
        if (method === "GET" && !bucket) { response.setHeader("content-type", "application/xml"); response.end(`<ListAllMyBucketsResult><Buckets>${[...buckets].map(name => `<Bucket><Name>${name}</Name><CreationDate>2026-11-14T12:00:00Z</CreationDate></Bucket>`).join("")}</Buckets></ListAllMyBucketsResult>`); return; }
        if (method === "PUT" && actual.search === "?versioning") { response.end(); return; }
        if (method === "PUT") { if (buckets.has(bucket)) { response.writeHead(409); response.end("<Error><Code>BucketAlreadyOwnedByYou</Code></Error>"); return; } buckets.add(bucket); response.setHeader("x-amz-request-id", `fictional-actual-request-${calls.length}`); response.end(); return; }
        if (method === "GET") { response.end(`<ListBucketResult>${backup ? "<Contents><Key>db/fictional.dump</Key></Contents><Contents><Key>db/fictional.dump.sha256</Key></Contents>" : ""}</ListBucketResult>`); return; }
      }
      if (path.pathname === "/remote") {
        if (request.headers.authorization !== "Bearer fictional-private-delivery") throw new Error("Private delivery fixture authentication missing");
        const value: unknown = JSON.parse(body);
        if (!value || typeof value !== "object") throw new Error("Invalid private delivery request");
        if ("path" in value && "content" in value && typeof value.path === "string" && typeof value.content === "string") files.set(value.path, value.content);
        if ("command" in value && typeof value.command === "string") {
          if (value.command.includes("./backup.sh")) backup = true;
          if (value.command.includes("docker compose up")) expect([...files.keys()]).toEqual(expect.arrayContaining(["/opt/freeholder/namespace-origin/public.pem", "/opt/freeholder/namespace-origin/receipt.json", "/opt/freeholder/namespace-origin/installation.json"]));
          return json({ code: 0, stdout: value.command === "cloud-init status" ? "status: done\n" : value.command.includes("grep -c 'schema is up to date'") ? "1\n" : "", stderr: "" });
        }
        return json({});
      }
      if (path.pathname === "/site/setup") { response.end("fictional setup"); return; }
      throw new Error(`Unexpected fictional TCP request: ${method} ${path.pathname}`);
    })().catch((error: unknown) => { failure = error instanceof Error ? error : new Error("Fictional TCP handler failed"); response.writeHead(500); response.end("fictional provider refused"); }); });
    server.listen(0, "127.0.0.1"); await once(server, "listening");
    const address = server.address(); if (!address || typeof address === "string") throw new Error("Actual TCP port required");
    const base = `http://127.0.0.1:${address.port}`;
    const fetcher: typeof globalThis.fetch = (input, init) => {
      const url = input instanceof URL ? input : typeof input === "string" ? new URL(input) : new URL(input.url);
      if (["ghcr.io", "raw.githubusercontent.com", "pkg-containers.githubusercontent.com", "github-registry-files.githubusercontent.com"].includes(url.hostname)) return fetch(input, init);
      const prefix = url.host === "api.digitalocean.com" ? "/api" : url.host === "nyc3.digitaloceanspaces.com" ? "/spaces" : "/site";
      return fetch(`${base}${prefix}${url.pathname}${url.search}`, init);
    };
    const deliver = async (value: unknown) => { const result = await fetch(`${base}/remote`, { method: "POST", headers: { authorization: "Bearer fictional-private-delivery", "content-type": "application/json" }, body: JSON.stringify(value) }); if (!result.ok) throw new Error("Fictional private delivery refused"); return result; };
    const remote: Remote = { async run(command) { return await (await deliver({ command })).json() as { code: number; stdout: string; stderr: string }; }, async upload(filesToUpload) { for (const file of filesToUpload) await deliver({ path: file.remote, content: await readFile(file.local, "utf8") }); }, async writeFile(path, content, mode) { await deliver({ path, content, mode }); } };
    try {
      const options = parseLaunchArgs(["launch", "--domain", "fictional.example", "--no-open", "--image", publishedImage], {});
      expect(await runLaunch(options, { provider: digitalOcean("fictional-owner-provider-token", fetcher, async () => undefined), remote: () => remote, fetcher, sleep: async () => undefined, resolve4: async () => [], configRoot: root, out: { log() {}, error() {} } })).toBe(0);
      const error = recordedFailure(); if (error) throw error;
      expect(droplet).toBe(true);
      const media = [...buckets].find(bucket => /-media-[a-f0-9]{32}$/.test(bucket)); if (!media) throw new Error("The actual original nonce namespace was not created");
      expect(calls.filter(call => call.method === "PUT" && call.path === `/spaces/${media}`)).toHaveLength(1);
      const publicKey = files.get("/opt/freeholder/namespace-origin/public.pem"), raw = files.get("/opt/freeholder/namespace-origin/receipt.json"), installation = files.get("/opt/freeholder/namespace-origin/installation.json"); if (!publicKey || !raw || !installation) throw new Error("Actual private installation delivery missing");
      const binding = { kind: "s3" as const, namespace: storageNamespace({ id: "s3", endpoint: "https://nyc3.digitaloceanspaces.com", bucket: media }), location: { endpoint: "https://nyc3.digitaloceanspaces.com", bucket: media } };
      const receipt: unknown = JSON.parse(raw), installed: unknown = JSON.parse(installation), identity = verifyNamespaceOriginArtifacts({ publicKey, receipt, installation: installed, binding });
      expect(() => requireInstalledNamespaceOrigin(identity, binding.namespace)).toThrow("privately installed");
      expect([...files.keys()].some(path => path.includes("private.pem"))).toBe(false);
      expect(raw).not.toContain("fictional-secret");
    } finally { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); await rm(root, { recursive: true, force: true }); }
  }, 60_000);
});
