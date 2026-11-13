// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.12/C11.08: a current-key 404 does not prove versions or sessions absent.
import { AwsClient } from "aws4fetch";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import type { S3Config } from "./s3";

function unavailable(): never {
  throw new Error("storage: complete physical absence could not be established; retain the original receipts for recovery");
}
async function document(response: Response): Promise<Record<string, unknown>> {
  if (!response.ok || !response.body) unavailable();
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > 262144) unavailable();
      chunks.push(next.value);
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  const xml = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
  if (/<!DOCTYPE|<!ENTITY|<!\[CDATA\[/i.test(xml) || XMLValidator.validate(xml) !== true) unavailable();
  const parsed: unknown = new XMLParser({ ignoreAttributes: true, parseTagValue: false, ignoreDeclaration: true, processEntities: true }).parse(xml);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) unavailable();
  return parsed as Record<string, unknown>;
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) unavailable();
  return value as Record<string, unknown>;
}

/** Read-only containment for the current ordinary-write protocol. A provider
 * that cannot prove never-enabled versioning cannot prove all original bytes
 * gone by HEAD. No historical generation or unassigned session is adopted or
 * deleted here. Provider/account acceptance remains separate.
 */
export async function verifyS3PhysicalAbsence(config: S3Config, key: string, request: typeof fetch = fetch): Promise<void> {
  const endpoint = new URL(config.endpoint);
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.search || endpoint.hash
    || !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(config.bucket) || !key || key.length > 2048 || /[\u0000-\u001f]/.test(key) || key.split("/").some(segment => segment === "." || segment === "..")) unavailable();
  const base = new URL(endpoint);
  if (config.addressingStyle === "virtual") base.hostname = config.bucket + "." + base.hostname;
  else base.pathname = base.pathname.replace(/\/$/, "") + "/" + config.bucket;
  const client = new AwsClient({ accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey, region: config.region, service: "s3", retries: 0 });
  const read = async (url: URL, method = "GET") => request(await client.sign(url.toString(), { method, redirect: "manual", signal: AbortSignal.timeout(15000) }));
  const neverVersioned = async () => {
    const url = new URL(base); url.searchParams.set("versioning", "");
    const result = await document(await read(url));
    // Suspended is historical versioning, not disabled. Missing permissions,
    // unknown policy extensions and malformed/duplicate states fail closed.
    if (Object.keys(result).length !== 1 || result.VersioningConfiguration !== "") unavailable();
  };
  await neverVersioned();
  const seen = new Set<string>();
  let keyMarker: string | undefined, uploadMarker: string | undefined;
  for (let page = 0; ; page++) {
    if (page >= 100) unavailable();
    const url = new URL(base);
    url.searchParams.set("uploads", ""); url.searchParams.set("prefix", key); url.searchParams.set("max-uploads", "100");
    if (keyMarker) url.searchParams.set("key-marker", keyMarker);
    if (uploadMarker) url.searchParams.set("upload-id-marker", uploadMarker);
    const parsed = await document(await read(url));
    if (Object.keys(parsed).length !== 1) unavailable();
    const result = record(parsed.ListMultipartUploadsResult);
    if (result.Bucket !== config.bucket || result.Prefix !== key || (result.IsTruncated !== "true" && result.IsTruncated !== "false")) unavailable();
    const uploads: unknown[] = result.Upload === undefined ? [] : Array.isArray(result.Upload) ? result.Upload : [result.Upload];
    if (uploads.length > 100) unavailable();
    for (const value of uploads) {
      const upload = record(value);
      if (typeof upload.Key !== "string" || typeof upload.UploadId !== "string" || !upload.UploadId || upload.UploadId.length > 4096) unavailable();
      // A same-key upload of unknown provenance remains debt. Prefix siblings
      // are neither attributed to this original nor modified.
      if (upload.Key === key || !upload.Key.startsWith(key)) unavailable();
    }
    if (result.IsTruncated === "false") break;
    if (typeof result.NextKeyMarker !== "string" || !result.NextKeyMarker || typeof result.NextUploadIdMarker !== "string" || !result.NextUploadIdMarker) unavailable();
    const marker = JSON.stringify([result.NextKeyMarker, result.NextUploadIdMarker]);
    if (seen.has(marker)) unavailable();
    seen.add(marker); keyMarker = result.NextKeyMarker; uploadMarker = result.NextUploadIdMarker;
  }
  const object = new URL(base);
  object.pathname = object.pathname.replace(/\/$/, "") + "/" + key.split("/").map(encodeURIComponent).join("/");
  const head = await read(object, "HEAD");
  if (head.status !== 404) unavailable();
  // Enabling versioning during inspection cannot produce a passing proof.
  await neverVersioned();
}
