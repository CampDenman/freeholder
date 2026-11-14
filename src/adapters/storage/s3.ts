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
import {createS3MultipartProtocol} from "../../../scripts/media-multipart-protocol.mjs";
import {createS3MultipartPartIssuer} from "../../../scripts/media-part-capability.mjs";
import {createS3TransferProtocol} from "../../../scripts/media-transfer-protocol.mjs";
import type {TransferRequestObserver} from "../../../scripts/media-transfer.mjs";
import {verifyS3PhysicalAbsence} from "./physical-absence";
import {storageNamespace} from "@/core/media/storage-quota";
import type {
  MultipartPart,
  MultipartInspection,
  MultipartObservation,
  SignedUrlOptions,
  StorageAdapter,
  StoredObject,
  StoredObjectRevision,
} from "@/adapters/storage/types";

export interface S3Config {
  /** e.g. https://sfo3.digitaloceanspaces.com — no bucket in the host. */
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Railway requires virtual-hosted URLs; most compatible stores accept path style. */
  addressingStyle?: "path" | "virtual";
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
  return xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`))?.[1]
    ?.replace(/&(quot|apos|lt|gt|amp);/g, (_, entity: string) => ({quot:'"',apos:"'",lt:"<",gt:">",amp:"&"})[entity]!);
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
    // Physical-operation receipts own retries. CREATE cannot be replayed
    // invisibly after an ambiguous 5xx response creates a remote resource.
    retries: 0,
  });

  const origin = config.endpoint.replace(/\/+$/, "");
  const storageBase = (() => {
    if (config.addressingStyle !== "virtual") return `${origin}/${config.bucket}`;
    const target = new URL(origin);
    target.hostname = `${config.bucket}.${target.hostname}`;
    return target.toString().replace(/\/+$/, "");
  })();
  const objectUrl = (key: string) => `${storageBase}/${encodeURI(key)}`;

  const multipartUrl = (key: string, uploadId?: string, partNumber?: number) => {
    const target = new URL(objectUrl(key));
    if (uploadId === undefined) target.searchParams.set("uploads", "");
    if (uploadId !== undefined) target.searchParams.set("uploadId", uploadId);
    if (partNumber !== undefined) {
      target.searchParams.set("partNumber", String(partNumber));
    }
    return target;
  };

  const accountedMultipart=(observer:TransferRequestObserver)=>createS3MultipartProtocol({client,binding:{kind:"s3",namespace:storageNamespace({id:"s3",endpoint:config.endpoint,bucket:config.bucket}),location:{endpoint:config.endpoint,bucket:config.bucket}},url:objectUrl,observer,retainXmlEvidence:true,requirePartChecksums:true});
  async function inspectMultipart(key: string, uploadId: string, observation?:MultipartObservation): Promise<MultipartInspection> {
    if(observation?.request)return accountedMultipart(observation.request).inspect(key,uploadId,observation.expectedParts);
    const parts: MultipartPart[] = [];
    let marker: string | undefined;
    for (let page = 0; page < 11; page++) {
      const url = multipartUrl(key, uploadId);
      if (marker) url.searchParams.set("part-number-marker", marker);
      const response = await client.fetch(url), xml = await response.text();
      if (response.status === 404 && xmlValue(xml, "Code") === "NoSuchUpload") return { state: "absent" };
      if (!response.ok || !/<ListPartsResult(?:\s|>)/.test(xml) || /<Error(?:\s|>)/.test(xml)) throw new Error(`storage: inspect original multipart upload failed (${response.status})`);
      for (const match of xml.matchAll(/<Part>([\s\S]*?)<\/Part>/g)) {
        const partNumber = Number(xmlValue(match[1]!, "PartNumber")), etag = xmlValue(match[1]!, "ETag"), bytes = Number(xmlValue(match[1]!, "Size"));
        if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > 10000 || !etag || !Number.isSafeInteger(bytes) || bytes < 0 || parts.some(part => part.partNumber === partNumber)) throw new Error("storage: invalid original multipart part inventory");
        parts.push({ partNumber, etag, bytes });
      }
      if (xmlValue(xml, "IsTruncated") !== "true") return { state: "open", parts };
      const next = xmlValue(xml, "NextPartNumberMarker");
      if (!next || next === marker || parts.length > 10000) throw new Error("storage: incomplete original multipart part inventory");
      marker = next;
    }
    throw new Error("storage: original multipart inventory exceeds the supported bound");
  }

  return {
    id: "s3",writeProtocol:"single-put-v1",
    isPublic: config.isPublic ?? false,
    // A public bucket would expose each unvalidated part/object before the
    // completion service can inspect or scan it. Direct upload is therefore a
    // private-bucket capability, not merely an S3 capability.
    directMultipart: config.isPublic ? undefined : {
      async create(key, contentType, observation) {
        if(observation?.request)return accountedMultipart(observation.request).create(key,contentType,observation.onAccepted);
        const response = await client.fetch(multipartUrl(key), {
          method: "POST",
          headers: { "content-type": contentType },
        });
        const body = await response.text();
        const uploadId = xmlValue(body, "UploadId");
        if (!response.ok || !uploadId || uploadId.length > 4096 || /[\u0000-\u001f]/.test(uploadId)) {
          throw new Error(
            `storage: start multipart upload for ${key} failed (${response.status}) ${body}`,
          );
        }
        await observation?.onAccepted?.({ uploadId });
        return { uploadId };
      },

      async signPart(key, uploadId, partNumber, expiresIn, observation) {
        if(observation?.request)return createS3MultipartPartIssuer({client,binding:{kind:"s3",namespace:storageNamespace({id:"s3",endpoint:config.endpoint,bucket:config.bucket}),location:{endpoint:config.endpoint,bucket:config.bucket}},url:objectUrl,observer:observation.request})({key,uploadId,partNumber,sha256:observation.sha256,bytes:observation.bytes,expiresAt:observation.expiresAt});
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

      async listParts(key, uploadId, observation) {
        const result = await inspectMultipart(key, uploadId,observation);
        if (result.state === "absent") throw new Error("storage: the original multipart upload is no longer present");
        return result.parts;
      },
      inspect: inspectMultipart,
      async listUploadsForKey(key) {
        const ids: string[] = [];
        let keyMarker: string | undefined, uploadMarker: string | undefined;
        for (let page = 0; page < 100; page++) {
          const url = new URL(storageBase);
          url.searchParams.set("uploads", "");
          url.searchParams.set("prefix", key);
          if (keyMarker) url.searchParams.set("key-marker", keyMarker);
          if (uploadMarker) url.searchParams.set("upload-id-marker", uploadMarker);
          const response = await client.fetch(url), xml = await response.text();
          if (!response.ok || !/<ListMultipartUploadsResult(?:\s|>)/.test(xml) || /<Error(?:\s|>)/.test(xml)) throw new Error("storage: original multipart inventory could not be established");
          for (const match of xml.matchAll(/<Upload>([\s\S]*?)<\/Upload>/g)) {
            const actualKey = xmlValue(match[1]!, "Key"), id = xmlValue(match[1]!, "UploadId");
            if (!actualKey || !id || id.length > 4096 || /[\u0000-\u001f]/.test(id)) throw new Error("storage: invalid original multipart inventory");
            if (actualKey === key) {
              if (ids.includes(id)) throw new Error("storage: repeated original multipart inventory entry");
              ids.push(id);
            }
          }
          const truncated = xmlValue(xml, "IsTruncated");
          if (truncated === "false") return ids;
          if (truncated !== "true") throw new Error("storage: incomplete original multipart inventory");
          const nextKey = xmlValue(xml, "NextKeyMarker"), nextUpload = xmlValue(xml, "NextUploadIdMarker");
          if (!nextKey || !nextUpload || (nextKey === keyMarker && nextUpload === uploadMarker)) throw new Error("storage: incomplete original multipart inventory");
          keyMarker = nextKey; uploadMarker = nextUpload;
        }
        throw new Error("storage: original multipart inventory exceeds the supported bound");
      },

      async complete(key, uploadId, parts, observation) {
        if(observation?.request)return accountedMultipart(observation.request).complete(key,uploadId,parts,observation.onAccepted);
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
        const acknowledgement = await response.text();
        if (!response.ok || /<Error(?:\s|>)/.test(acknowledgement) || !/<CompleteMultipartUploadResult(?:\s|\/|>)/.test(acknowledgement)) {
          throw new Error(
            `storage: complete original multipart upload failed (${response.status})`,
          );
        }
        await observation?.onAccepted?.();
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

      async abort(key, uploadId, observation) {
        if(observation?.request)return accountedMultipart(observation.request).abort(key,uploadId,observation.onAccepted);
        const response = await client.fetch(multipartUrl(key, uploadId), {
          method: "DELETE",
        });
        const body = await response.text();
        if (!response.ok && !(response.status === 404 && xmlValue(body, "Code") === "NoSuchUpload")) {
          throw new Error(
            `storage: abort multipart upload for ${key} failed (${response.status})`,
          );
        }
        await observation?.onAccepted?.();
      },
    },

    async put(key, body, contentType, observation): Promise<StoredObject> {
      if(observation?.request){
        let originalRevision:StoredObjectRevision|undefined;
        const request:TransferRequestObserver=(descriptor,operation)=>observation.request!(descriptor,async(notify,identity)=>operation(async facts=>{await notify(facts);if(facts.stage==="metadata"&&facts.revision)originalRevision=facts.revision;},identity));
        const namespace=storageNamespace({id:"s3",endpoint:config.endpoint,bucket:config.bucket});
        const protocol=createS3TransferProtocol({client,binding:{kind:"s3",namespace,location:{endpoint:config.endpoint,bucket:config.bucket}},url:objectUrl,observer:request});
        await protocol.put(key,body,contentType);await observation.onAccepted?.({revision:originalRevision});
        return{key,bytes:body.byteLength,contentType};
      }

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
      const value=response.headers.get("etag"),versionId=response.headers.get("x-amz-version-id");
      const valid=value!==null&&/^"[\x21\x23-\x7e\x80-\xff]+"$/.test(value)&&(!versionId||versionId.length<=4096&&!/[\u0000-\u001f\u007f]/.test(versionId));
      await observation?.onAccepted?.({revision:valid?{kind:"etag",key,namespace:storageNamespace({id:"s3",endpoint:config.endpoint,bucket:config.bucket}),value,...(versionId?{versionId}:{})}:undefined});
      // Missing revision stays explicit provenance debt; success is no retirement authority.
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

    verifyPhysicalAbsence:key=>verifyS3PhysicalAbsence(config,key),
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
        const base = (config.publicBaseUrl ?? storageBase)
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
