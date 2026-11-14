// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Just enough S3 (AWS Signature Version 4) for Spaces: create a bucket, turn
// on versioning, list objects, delete an empty bucket. No SDK, so the CLI
// stays dependency-free and every request can be tested against a fake.
import { createHash, createHmac } from "node:crypto";

export interface S3Credentials {
  accessKeyId: string;
  secretAccessKey: string;
}

/** Installed by the real launcher; records no Authorization header or key. */
export interface BucketCreateObserver {
  response(fact: { status: number; requestIdDigest: string | null; providerDate: string | null; bodyDigest: string }): Promise<void>;
  returned(): Promise<void>;
}

const sha256 = (data: string) => createHash("sha256").update(data).digest("hex");
const hmac = (key: Buffer | string, data: string) => createHmac("sha256", key).update(data).digest();

export function signS3(request: { method: string; url: URL; body: string; region: string; credentials: S3Credentials; now?: Date }): Record<string, string> {
  const now = request.now ?? new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const day = amzDate.slice(0, 8);
  const payloadHash = sha256(request.body);
  const query = [...request.url.searchParams.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
  const headers: Record<string, string> = { host: request.url.host, "x-amz-content-sha256": payloadHash, "x-amz-date": amzDate };
  const signedHeaders = Object.keys(headers).sort().join(";");
  const canonical = [request.method, request.url.pathname || "/", query, ...Object.keys(headers).sort().map((k) => `${k}:${headers[k]}`), "", signedHeaders, payloadHash].join("\n");
  const scope = `${day}/${request.region}/s3/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonical)].join("\n");
  const key = hmac(hmac(hmac(hmac(`AWS4${request.credentials.secretAccessKey}`, day), request.region), "s3"), "aws4_request");
  const signature = createHmac("sha256", key).update(toSign).digest("hex");
  return { ...headers, authorization: `AWS4-HMAC-SHA256 Credential=${request.credentials.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}` };
}

export class SpacesClient {
  constructor(
    private readonly endpoint: string,
    private readonly region: string,
    private readonly credentials: S3Credentials,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  private async request(method: string, bucket: string, query = "", body = "", bounded = false): Promise<{ status: number; text: string; requestId: string | null; providerDate: string | null }> {
    const url = new URL(`${this.endpoint.replace(/\/+$/, "")}/${bucket}${query}`);
    const headers = signS3({ method, url, body, region: this.region, credentials: this.credentials });
    const response = await this.fetcher(url, { method, headers, redirect: "error", ...(body ? { body } : {}) });
    let text: string;
    if (bounded && response.body) {
      const reader = response.body.getReader(), chunks: Uint8Array[] = []; let bytes = 0;
      try { for (;;) { const part = await reader.read(); if (part.done) break; bytes += part.value.byteLength; if (bytes > 4 * 1024 * 1024) { await reader.cancel(); throw new Error("Spaces bucket metadata is too large to verify."); } chunks.push(part.value); } }
      finally { reader.releaseLock(); }
      text = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
    } else text = await response.text();
    return { status: response.status, text, requestId: response.headers.get("x-amz-request-id"), providerDate: response.headers.get("date") };
  }

  /** Create a private bucket. True when it was created, false when this account already had it. */
  async createBucket(bucket: string, observer?: BucketCreateObserver): Promise<boolean> {
    const { status, text, requestId, providerDate } = await this.request("PUT", bucket, "", "", Boolean(observer));
    if (observer) { await observer.response({ status, bodyDigest: sha256(text), requestIdDigest: requestId ? sha256(requestId) : null, providerDate: providerDate && Number.isFinite(Date.parse(providerDate)) ? new Date(providerDate).toISOString() : null }); await observer.returned(); }
    if (status === 200) return true;
    if (status === 409 && text.includes("BucketAlreadyOwnedByYou")) return false;
    if (status === 409) throw new Error(`The bucket name ${bucket} is taken by someone else.`);
    throw new Error(`Spaces refused to create ${bucket} (${status}).`);
  }

  /** Account-owned provider metadata, used only by the one-shot origin producer.
   * A listing is corroboration; it cannot by itself establish freshness. */
  async bucketMetadata(): Promise<string> {
    const result = await this.request("GET", "", "", "", true);
    if (result.status !== 200) throw new Error(`Spaces could not verify namespace metadata (${result.status}).`);
    return result.text;
  }

  async enableVersioning(bucket: string): Promise<void> {
    const body = '<VersioningConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Status>Enabled</Status></VersioningConfiguration>';
    const { status } = await this.request("PUT", bucket, "?versioning", body);
    if (status !== 200) throw new Error(`Spaces refused to turn on versioning for ${bucket} (${status}).`);
  }

  async listKeys(bucket: string, prefix = ""): Promise<string[]> {
    const { status, text } = await this.request("GET", bucket, `?list-type=2&prefix=${encodeURIComponent(prefix)}`);
    if (status !== 200) throw new Error(`Spaces could not list ${bucket} (${status}).`);
    return [...text.matchAll(/<Key>([^<]+)<\/Key>/g)].map((m) => m[1]!);
  }

  /** Delete a bucket only if it is empty. True when deleted. */
  async deleteEmptyBucket(bucket: string): Promise<boolean> {
    const { status } = await this.request("DELETE", bucket);
    if (status === 204 || status === 404) return true;
    if (status === 409) return false;
    throw new Error(`Spaces refused to delete ${bucket} (${status}).`);
  }
}
