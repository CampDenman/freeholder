// Copyright (C) 2026 Camp Denman Society
// SPDX-License-Identifier: AGPL-3.0-only
// S3-compatible storage: DigitalOcean Spaces, Cloudflare R2, MinIO, Backblaze
// B2, AWS S3 itself. One implementation covers all of them because they share
// the same signed HTTP protocol — which is exactly why §12 names the family
// "S3-compatible" rather than a vendor.
//
// Signed with aws4fetch over the platform's own fetch, rather than the AWS SDK.
// The SDK brings roughly fifteen megabytes of transitive dependencies for the
// four operations used here, and install size is not a detail on a Replit box
// or a small droplet (§14).
import { AwsClient } from "aws4fetch";
import type {
  SignedUrlOptions,
  StorageAdapter,
  StoredObject,
} from "@/adapters/storage/types";

export interface S3Config {
  /** e.g. https://sfo3.digitaloceanspaces.com — no bucket in the host. */
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /**
   * Serve objects from here instead of the bucket endpoint — a CDN or a custom
   * domain. Only meaningful when the bucket is public.
   */
  publicBaseUrl?: string;
  /** Public buckets skip signing; private ones sign every read. */
  isPublic?: boolean;
}

const DEFAULT_EXPIRY_SECONDS = 60 * 15;

export function createS3Storage(config: S3Config): StorageAdapter {
  const client = new AwsClient({
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    region: config.region,
    service: "s3",
  });

  const origin = config.endpoint.replace(/\/+$/, "");
  const objectUrl = (key: string) =>
    `${origin}/${config.bucket}/${encodeURI(key)}`;

  return {
    id: "s3",
    isPublic: config.isPublic ?? false,

    async put(key, body, contentType): Promise<StoredObject> {
      // A Blob rather than the raw view: it carries the content type with it.
      const response = await client.fetch(objectUrl(key), {
        method: "PUT",
        body: new Blob([body], { type: contentType }),
        headers: { "content-length": String(body.byteLength) },
      });
      if (!response.ok) {
        // The body carries the provider's XML error; it is the only useful
        // thing to say when a bucket name or key is wrong.
        throw new Error(
          `storage: PUT ${key} failed (${response.status}) ${await response.text()}`,
        );
      }
      return { key, bytes: body.byteLength, contentType };
    },

    async get(key): Promise<Uint8Array<ArrayBuffer> | undefined> {
      const response = await client.fetch(objectUrl(key));
      if (response.status === 404) return undefined;
      if (!response.ok) {
        throw new Error(`storage: GET ${key} failed (${response.status})`);
      }
      return new Uint8Array(await response.arrayBuffer());
    },

    async delete(key): Promise<void> {
      const response = await client.fetch(objectUrl(key), {
        method: "DELETE",
      });
      // S3 answers 204 for a delete, and 404 means the caller's intent is
      // already satisfied — deleting what is not there is not a failure.
      if (!response.ok && response.status !== 404) {
        throw new Error(`storage: DELETE ${key} failed (${response.status})`);
      }
    },

    async url(key, options: SignedUrlOptions = {}): Promise<string> {
      if (config.isPublic) {
        const base = (config.publicBaseUrl ?? `${origin}/${config.bucket}`)
          .replace(/\/+$/, "");
        return `${base}/${encodeURI(key)}`;
      }
      const target = new URL(objectUrl(key));
      target.searchParams.set(
        "X-Amz-Expires",
        String(options.expiresIn ?? DEFAULT_EXPIRY_SECONDS),
      );
      if (options.downloadAs) {
        target.searchParams.set(
          "response-content-disposition",
          `attachment; filename="${options.downloadAs.replace(/"/g, "")}"`,
        );
      }
      const signed = await client.sign(target.toString(), {
        method: "GET",
        aws: { signQuery: true },
      });
      return signed.url;
    },
  };
}
