// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// A launch never follows a floating tag: given no digest, it resolves the
// current `edge` index to its linux/amd64 manifest and pins that.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import { assertOriginRuntimeProfile, assertReleaseAttestation, attestationArguments, ORIGIN_RUNTIME_PROFILE_PATH } from "./image-admission.mjs";
export const IMAGE_REPOSITORY = "ghcr.io/campdenman/freeholder";
const DIGEST = /^ghcr\.io\/campdenman\/freeholder@sha256:[0-9a-f]{64}$/;

export function isPinned(image: string): boolean {
  return DIGEST.test(image);
}

const execFileAsync = promisify(execFile);
const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("The image metadata is malformed.");
  return value as Record<string, unknown>;
}
async function boundedText(response: Response, limit: number): Promise<string> {
  if (!response.ok || !response.body) throw new Error("The image admission metadata could not be read.");
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let bytes = 0;
  try { for (;;) { const part = await reader.read(); if (part.done) break; bytes += part.value.byteLength; if (bytes > limit) { await reader.cancel(); throw new Error("The image admission metadata exceeded its safe bound."); } chunks.push(part.value); } }
  finally { reader.releaseLock(); }
  return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
}
async function registryGet(url: string, headers: Record<string, string>, fetcher: typeof fetch): Promise<Response> {
  let target = new URL(url), currentHeaders = headers;
  for (let redirects = 0; redirects < 3; redirects++) {
    const response = await fetcher(target, { headers: currentHeaders, redirect: "manual" });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    await response.body?.cancel();
    const location = response.headers.get("location"); if (!location) throw new Error("The registry redirect is incomplete.");
    const next = new URL(location, target);
    if (next.protocol !== "https:" || next.username || next.password || next.port || !["ghcr.io", "pkg-containers.githubusercontent.com", "github-registry-files.githubusercontent.com"].includes(next.hostname)) throw new Error("The registry redirected outside the supported private-credential boundary.");
    // GH's documented container CDN receives no registry bearer credential.
    if (next.origin !== target.origin) currentHeaders = {};
    target = next;
  }
  throw new Error("The registry redirect chain is incomplete.");
}
/** Genuine source admission, before a new namespace, provider key or machine
 * is bought. No Boolean label, public caller proof, post-start healthcheck or
 * injected verifier can make an older/custom image compatible. */
export async function requireNamespaceOriginImage(image: string | undefined, fetcher: typeof fetch = fetch): Promise<{ image: string; sourceRevision: string; profileDigest: string }> {
  if (!image || !isPinned(image)) throw new Error("Pin a compatible released image before creating new storage.");
  const tokenResponse = await fetcher("https://ghcr.io/token?scope=repository:campdenman/freeholder:pull", { redirect: "error" });
  if (!tokenResponse.ok) throw new Error("The image registry refused the public pull-token request.");
  const auth = record(await tokenResponse.json());
  if (typeof auth.token !== "string" || !auth.token) throw new Error("The image registry did not issue a pull token.");
  const authorization = { authorization: `Bearer ${auth.token}` }, pin = image.slice(image.indexOf("sha256:"));
  const manifestText = await boundedText(await registryGet(`https://ghcr.io/v2/campdenman/freeholder/manifests/${pin}`, { ...authorization, accept: "application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json" }, fetcher), 8 * 1024 * 1024);
  if (`sha256:${sha256(manifestText)}` !== pin) throw new Error("The exact image manifest digest did not match the pin.");
  const manifest = record(JSON.parse(manifestText)), descriptor = record(manifest.config);
  if (manifest.schemaVersion !== 2 || typeof manifest.mediaType !== "string" || !["application/vnd.oci.image.manifest.v1+json", "application/vnd.docker.distribution.manifest.v2+json"].includes(manifest.mediaType) || !Array.isArray(manifest.layers) || manifest.layers.length === 0 || typeof descriptor.mediaType !== "string" || !["application/vnd.oci.image.config.v1+json", "application/vnd.docker.container.image.v1+json"].includes(descriptor.mediaType) || typeof descriptor.digest !== "string" || !/^sha256:[a-f0-9]{64}$/.test(descriptor.digest) || typeof descriptor.size !== "number" || !Number.isSafeInteger(descriptor.size) || descriptor.size <= 0 || descriptor.size > 8 * 1024 * 1024) throw new Error("The image pin is not a bounded runtime manifest.");
  const configText = await boundedText(await registryGet(`https://ghcr.io/v2/campdenman/freeholder/blobs/${descriptor.digest}`, authorization, fetcher), descriptor.size);
  if (Buffer.byteLength(configText) !== descriptor.size || `sha256:${sha256(configText)}` !== descriptor.digest) throw new Error("The exact image configuration bytes did not match its manifest.");
  const config = record(JSON.parse(configText)), labels = record(record(config.config).Labels);
  const profileDigest = labels["io.freeholder.storage.origin.profile.sha256"], revision = labels["org.opencontainers.image.revision"];
  if (config.os !== "linux" || config.architecture !== "amd64" || typeof profileDigest !== "string" || !/^[a-f0-9]{64}$/.test(profileDigest) || typeof revision !== "string" || !/^[a-f0-9]{40}$/.test(revision) || labels["org.opencontainers.image.source"] !== "https://github.com/CampDenman/freeholder") throw new Error("This image does not support the complete original storage initializer and first-write fence.");
  let stdout: string;
  try { ({ stdout } = await execFileAsync("gh", attestationArguments(image), { maxBuffer: 10 * 1024 * 1024, timeout: 30_000 })); }
  catch { throw new Error("The image's public provenance could not be verified. Use GitHub CLI to verify the exact released image before creating storage."); }
  const provenance: unknown = JSON.parse(stdout), sourceRevision = assertReleaseAttestation(provenance, { pin: image, gitSha: revision });
  const base = `https://raw.githubusercontent.com/CampDenman/freeholder/${sourceRevision}/`;
  const profileText = await boundedText(await fetcher(`${base}${ORIGIN_RUNTIME_PROFILE_PATH}`, { redirect: "error" }), 65536);
  if (sha256(profileText) !== profileDigest) throw new Error("The admitted image/source profile bytes disagree.");
  const profileValue: unknown = JSON.parse(profileText), profile = assertOriginRuntimeProfile(profileValue);
  for (const source of profile.sources) {
    const actual = await boundedText(await fetcher(`${base}${source.path}`, { redirect: "error" }), 4 * 1024 * 1024);
    if (sha256(actual) !== source.sha256) throw new Error("The admitted runtime profile does not match its actual source and guarded migration.");
  }
  return { image, sourceRevision, profileDigest };
}

export async function resolveEdgeImage(fetcher: typeof fetch = fetch): Promise<string> {
  const token = (await (await fetcher("https://ghcr.io/token?scope=repository:campdenman/freeholder:pull")).json()) as { token?: string };
  if (!token.token) throw new Error("GitHub's registry did not issue a pull token.");
  const response = await fetcher("https://ghcr.io/v2/campdenman/freeholder/manifests/edge", {
    headers: { authorization: `Bearer ${token.token}`, accept: "application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json" },
  });
  if (!response.ok) throw new Error(`The edge image could not be read (${response.status}).`);
  const index = (await response.json()) as { manifests?: { digest: string; platform?: { os?: string; architecture?: string } }[] };
  const amd64 = index.manifests?.find((m) => m.platform?.os === "linux" && m.platform.architecture === "amd64");
  if (!amd64 || !/^sha256:[0-9a-f]{64}$/.test(amd64.digest)) throw new Error("The edge image has no linux/amd64 manifest.");
  return `${IMAGE_REPOSITORY}@${amd64.digest}`;
}
