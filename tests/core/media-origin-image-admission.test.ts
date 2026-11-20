// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// PREPARED / UNRUN. Pure grammar/refusal plumbing, no fake gh verifier,
// signed compatible image, runtime capability, provider account or launch pass.
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { assertOriginRuntimeProfile, ORIGIN_RUNTIME_PROFILE_SOURCES, assertReleaseAttestation as sharedAttestation, attestationArguments as sharedArguments } from "../../packages/cli/src/launch/image-admission.mjs";
import { requireNamespaceOriginImage } from "../../packages/cli/src/launch/image";
import { digitalOcean } from "../../packages/cli/src/launch/digitalocean";
import { parseLaunchArgs } from "../../packages/cli/src/launch/args";
import type { LaunchState } from "../../packages/cli/src/launch/types";
import { assertReleaseAttestation as operatorAttestation, attestationArguments as operatorArguments } from "../../scripts/deploy-droplet.mjs";
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const object = () => ({ format: "freeholder/original-quota-runtime-profile/v1", protocols: { origin: "freeholder.provider-namespace-origin/v1", initialization: "original-quota-namespace-initialization/v1", firstWrite: "original-namespace-before-first-write/v1", journal: "original-quota-origin-journal/v1", restore: "original-quota-origin-restore-fence/v1" }, sources: ORIGIN_RUNTIME_PROFILE_SOURCES.map(path => ({ path, sha256: "a".repeat(64) })) });
function metadata(options: { redirect?: string; corruptConfig?: boolean; wrongPin?: boolean } = {}) {
  const config = JSON.stringify({ os: "linux", architecture: "amd64", config: { Labels: { "org.opencontainers.image.source": "https://github.com/CampDenman/freeholder", "org.opencontainers.image.revision": "b".repeat(40), "io.freeholder.storage.quota.version": "1", "io.freeholder.deployment.admission.version": "1" } } });
  const manifest = JSON.stringify({ schemaVersion: 2, mediaType: "application/vnd.oci.image.manifest.v1+json", config: { mediaType: "application/vnd.oci.image.config.v1+json", digest: `sha256:${hash(config)}`, size: Buffer.byteLength(config) }, layers: [{ mediaType: "application/vnd.oci.image.layer.v1.tar+gzip", digest: `sha256:${"c".repeat(64)}`, size: 100 }] });
  const image = `ghcr.io/campdenman/freeholder@sha256:${options.wrongPin ? "f".repeat(64) : hash(manifest)}`;
  const calls: { url: URL; headers: Headers }[] = [];
  const fetcher: typeof globalThis.fetch = async (input, init) => {
    const url = input instanceof URL ? input : typeof input === "string" ? new URL(input) : new URL(input.url);
    calls.push({ url, headers: new Headers(init?.headers) });
    if (url.pathname === "/token") return Response.json({ token: "fictional-public-registry-pull-token" });
    if (url.pathname.includes("/manifests/")) return new Response(manifest);
    if (url.pathname.includes("/blobs/")) {
      if (url.hostname === "ghcr.io" && options.redirect) return new Response(null, { status: 307, headers: { location: options.redirect } });
      return new Response(options.corruptConfig ? config.replace('"linux"', '"other"') : config);
    }
    throw new Error("Unexpected image metadata request; no supported attestation/profile is present in this fixture");
  };
  return { image, calls, fetcher };
}
describe("new namespace image admission containment", () => {
  it("reuses the exact existing strict operator provenance validators, including their original runtime function identity", () => {
    expect(operatorAttestation).toBe(sharedAttestation); expect(operatorArguments).toBe(sharedArguments);
  });
  it("parses the finite complete source-profile grammar as data only, without making a verified runtime or authority", () => {
    const value = object(); expect(assertOriginRuntimeProfile(value)).toBe(value);
    expect(value).not.toHaveProperty("verified");
  });
  it.each(["missing", "duplicate", "reordered", "traversal"])("refuses %s source membership instead of accepting a partial or caller-selected runtime contract", mode => {
    const value = object();
    const first = value.sources[0]; if (!first) throw new Error("The finite reader source inventory must be nonempty");
    if (mode === "missing") value.sources.pop();
    if (mode === "duplicate") value.sources[1] = first;
    if (mode === "reordered") value.sources.reverse();
    if (mode === "traversal") value.sources[0] = { path: "../private.env", sha256: "a".repeat(64) };
    expect(() => assertOriginRuntimeProfile(value)).toThrow("supported original storage");
  });
  it("refuses old generic labels even when actual manifest/config bytes match the requested pin", async () => {
    const f = metadata(); await expect(requireNamespaceOriginImage(f.image, f.fetcher)).rejects.toThrow("does not support the complete");
    expect(f.calls).toHaveLength(3);
    expect(f.calls.some(call => call.url.hostname === "api.digitalocean.com")).toBe(false);
  });
  it("refuses mismatched actual pinned manifest bytes before fetching an image config", async () => {
    const f = metadata({ wrongPin: true }); await expect(requireNamespaceOriginImage(f.image, f.fetcher)).rejects.toThrow("manifest digest"); expect(f.calls).toHaveLength(2);
  });
  it("refuses changed actual config bytes rather than trusting an image name or declared label", async () => {
    const f = metadata({ corruptConfig: true }); await expect(requireNamespaceOriginImage(f.image, f.fetcher)).rejects.toThrow("configuration bytes"); expect(f.calls).toHaveLength(3);
  });
  it("follows the documented container CDN without forwarding a registry bearer token, and still refuses its unsupported actual image", async () => {
    const f = metadata({ redirect: "https://pkg-containers.githubusercontent.com/ghcr1/blobs/sha256/fictional" });
    await expect(requireNamespaceOriginImage(f.image, f.fetcher)).rejects.toThrow("does not support the complete");
    expect(f.calls).toHaveLength(4); expect(f.calls.at(-1)?.headers.has("authorization")).toBe(false);
  });
  it.each(["http://pkg-containers.githubusercontent.com/blobs/fictional", "https://127.0.0.1/blobs/fictional", "https://owner:private@pkg-containers.githubusercontent.com/blobs/fictional"])("refuses an unsafe registry redirect before dispatch", async location => {
    const f = metadata({ redirect: location }); await expect(requireNamespaceOriginImage(f.image, f.fetcher)).rejects.toThrow("credential boundary"); expect(f.calls).toHaveLength(3);
  });
});

function accountFixture(identity: boolean) {
  const f = metadata(), requests: { method: string; path: string }[] = [];
  const fetcher: typeof globalThis.fetch = async (input, init) => {
    const url = input instanceof URL ? input : typeof input === "string" ? new URL(input) : new URL(input.url);
    requests.push({ method: init?.method ?? "GET", path: url.pathname });
    if (url.hostname !== "api.digitalocean.com") return f.fetcher(input, init);
    if (url.pathname === "/v2/account") return Response.json({ account: { status: "active", ...(identity ? { uuid: "00000000-0000-4000-8000-000000000101" } : {}) } });
    if (url.pathname === "/v2/account/keys") return Response.json({ ssh_keys: [{ id: 11, name: "fictional-owned", fingerprint: "fictional" }] });
    if (url.pathname === "/v2/regions") return Response.json({ regions: [{ slug: "nyc3", available: true, sizes: ["s-2vcpu-2gb"] }] });
    if (url.pathname === "/v2/sizes") return Response.json({ sizes: [{ slug: "s-2vcpu-2gb", price_monthly: 18 }] });
    if (url.pathname === "/v2/droplets") return Response.json({ droplets: [] });
    throw new Error("No provider creation or storage request is authorized by this unsupported fixture");
  };
  const options = parseLaunchArgs(["launch", "--domain", "fictional.example", "--no-open", "--image", f.image], {});
  const state: LaunchState = { version: 1, name: options.name, provider: "digitalocean", domain: options.domain, region: options.region, size: options.size, done: ["preflight", "image", "secrets"], image: f.image };
  return { ...f, options, state, requests, provider: digitalOcean("fictional-owner-account-token", fetcher, async () => undefined) };
}
describe("actual new DigitalOcean origin path refuses unsupported admission before provider mutations", () => {
  it("refuses a new unknown account before key/bucket/server purchase instead of downgrading it to legacy", async () => {
    const f = accountFixture(false); await expect(f.provider.preflight(f.options, null)).rejects.toThrow("account identity");
    expect(f.requests).toEqual([{ method: "GET", path: "/v2/account" }]);
  });
  it("does not turn a failed new state without an original bucket into a legacy cohort on retry", async () => {
    const f = accountFixture(false); await expect(f.provider.preflight(f.options, f.state)).rejects.toThrow("account identity");
    expect(f.requests.every(request => request.method === "GET")).toBe(true);
  });
  it("refuses a genuinely identified new account's unsupported image before nonce admission, temporary key or bucket creation", async () => {
    const f = accountFixture(true); await f.provider.preflight(f.options, null); let saves = 0;
    await expect(f.provider.storage(f.options, f.state, async () => { saves++; }, "/unused-fictional-origin-directory")).rejects.toThrow("does not support the complete");
    expect(saves).toBe(0); expect(f.requests.every(request => request.method === "GET")).toBe(true);
    expect(f.requests.some(request => request.path.includes("spaces"))).toBe(false);
  });
  it("preserves an actual retained no-origin bucket/key cohort without granting it new origin or image compatibility", async () => {
    const f = accountFixture(false), state = { ...f.state, buckets: { media: "fictional-old-media", backups: "fictional-old-backups" }, spacesKeyId: "fictional-existing-key" };
    await f.provider.preflight(f.options, state); let saves = 0;
    await f.provider.storage(f.options, state, async () => { saves++; }, "/unused-fictional-origin-directory");
    expect(saves).toBe(0); expect(state).not.toHaveProperty("namespaceOrigin"); expect(f.calls).toHaveLength(0);
  });
});
