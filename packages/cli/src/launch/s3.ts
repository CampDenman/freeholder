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

  private async request(method: string, bucket: string, query = "", body = ""): Promise<{ status: number; text: string }> {
    const url = new URL(`${this.endpoint.replace(/\/+$/, "")}/${bucket}${query}`);
    const headers = signS3({ method, url, body, region: this.region, credentials: this.credentials });
    const response = await this.fetcher(url, { method, headers, ...(body ? { body } : {}) });
    return { status: response.status, text: await response.text() };
  }

  /** Create a private bucket. True when it was created, false when this account already had it. */
  async createBucket(bucket: string): Promise<boolean> {
    const { status, text } = await this.request("PUT", bucket);
    if (status === 200) return true;
    if (status === 409 && text.includes("BucketAlreadyOwnedByYou")) return false;
    if (status === 409) throw new Error(`The bucket name ${bucket} is taken by someone else.`);
    throw new Error(`Spaces refused to create ${bucket} (${status}).`);
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
