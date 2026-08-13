// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
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
  MultipartPart,
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

function xmlValue(xml: string, name: string): string | undefined {
  return xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`))?.[1];
}

function xmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

async function* responseChunks(
  body: ReadableStream<Uint8Array>,
): AsyncIterable<Uint8Array<ArrayBuffer>> {
  const reader = body.getReader();
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) return;
      // Copy so the contract is an ordinary ArrayBuffer, never a shared view.
      yield new Uint8Array(next.value);
    }
  } finally {
    reader.releaseLock();
  }
}

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

  const multipartUrl = (key: string, uploadId?: string, partNumber?: number) => {
    const target = new URL(objectUrl(key));
    if (uploadId === undefined) target.searchParams.set("uploads", "");
    if (uploadId !== undefined) target.searchParams.set("uploadId", uploadId);
    if (partNumber !== undefined) {
      target.searchParams.set("partNumber", String(partNumber));
    }
    return target;
  };

  return {
    id: "s3",
    isPublic: config.isPublic ?? false,
    // A public bucket would expose each unvalidated part/object before the
    // completion service can inspect or scan it. Direct upload is therefore a
    // private-bucket capability, not merely an S3 capability.
    directMultipart: config.isPublic ? undefined : {
      async create(key, contentType) {
        const response = await client.fetch(multipartUrl(key), {
          method: "POST",
          headers: { "content-type": contentType },
        });
        const body = await response.text();
        const uploadId = xmlValue(body, "UploadId");
        if (!response.ok || !uploadId) {
          throw new Error(
            `storage: start multipart upload for ${key} failed (${response.status}) ${body}`,
          );
        }
        return { uploadId };
      },

      async signPart(key, uploadId, partNumber, expiresIn) {
        const target = multipartUrl(key, uploadId, partNumber);
        target.searchParams.set(
          "X-Amz-Expires",
          String(expiresIn ?? DEFAULT_EXPIRY_SECONDS),
        );
        const signed = await client.sign(target.toString(), {
          method: "PUT",
          aws: { signQuery: true },
        });
        return { url: signed.url, method: "PUT" as const };
      },

      async listParts(key, uploadId) {
        const response = await client.fetch(multipartUrl(key, uploadId));
        if (!response.ok) {
          throw new Error(
            `storage: list multipart parts for ${key} failed (${response.status})`,
          );
        }
        const xml = await response.text();
        return [...xml.matchAll(/<Part>([\s\S]*?)<\/Part>/g)]
          .map((match): MultipartPart | undefined => {
            const partNumber = Number(xmlValue(match[1]!, "PartNumber"));
            const etag = xmlValue(match[1]!, "ETag");
            const bytes = Number(xmlValue(match[1]!, "Size"));
            if (!Number.isInteger(partNumber) || !etag) return undefined;
            return {
              partNumber,
              etag,
              bytes: Number.isFinite(bytes) ? bytes : undefined,
            };
          })
          .filter((part): part is MultipartPart => Boolean(part));
      },

      async complete(key, uploadId, parts) {
        const body = `<CompleteMultipartUpload>${[...parts]
          .sort((a, b) => a.partNumber - b.partNumber)
          .map(
            (part) =>
              `<Part><PartNumber>${part.partNumber}</PartNumber><ETag>${xmlEscape(part.etag)}</ETag></Part>`,
          )
          .join("")}</CompleteMultipartUpload>`;
        const response = await client.fetch(multipartUrl(key, uploadId), {
          method: "POST",
          headers: { "content-type": "application/xml" },
          body,
        });
        if (!response.ok) {
          throw new Error(
            `storage: complete multipart upload for ${key} failed (${response.status}) ${await response.text()}`,
          );
        }
        const result = await client.fetch(objectUrl(key), { method: "HEAD" });
        if (!result.ok) {
          throw new Error(
            `storage: completed multipart object ${key} could not be inspected (${result.status})`,
          );
        }
        return {
          key,
          bytes: Number(result.headers.get("content-length") ?? 0),
          contentType:
            result.headers.get("content-type") ?? "application/octet-stream",
          etag: result.headers.get("etag") ?? undefined,
        };
      },

      async abort(key, uploadId) {
        const response = await client.fetch(multipartUrl(key, uploadId), {
          method: "DELETE",
        });
        if (!response.ok && response.status !== 404) {
          throw new Error(
            `storage: abort multipart upload for ${key} failed (${response.status})`,
          );
        }
      },
    },

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

    async head(key) {
      const response = await client.fetch(objectUrl(key), { method: "HEAD" });
      if (response.status === 404) return undefined;
      if (!response.ok) {
        throw new Error(`storage: HEAD ${key} failed (${response.status})`);
      }
      return {
        key,
        bytes: Number(response.headers.get("content-length") ?? 0),
        contentType:
          response.headers.get("content-type") ?? "application/octet-stream",
        etag: response.headers.get("etag") ?? undefined,
      };
    },

    async readRange(key, start, endInclusive) {
      const response = await client.fetch(objectUrl(key), {
        headers: { range: `bytes=${start}-${endInclusive}` },
      });
      if (response.status === 404) return undefined;
      if (!response.ok) {
        throw new Error(`storage: ranged GET ${key} failed (${response.status})`);
      }
      return new Uint8Array(await response.arrayBuffer());
    },

    async stream(key) {
      const response = await client.fetch(objectUrl(key));
      if (response.status === 404) return undefined;
      if (!response.ok || !response.body) {
        throw new Error(`storage: streaming GET ${key} failed (${response.status})`);
      }
      return responseChunks(response.body);
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
      if (options.contentType) {
        target.searchParams.set("response-content-type", options.contentType);
      }
      const signed = await client.sign(target.toString(), {
        method: "GET",
        aws: { signQuery: true },
      });
      return signed.url;
    },
  };
}
