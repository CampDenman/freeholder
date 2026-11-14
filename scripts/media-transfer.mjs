// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Copy and byte-verify every object named by an ownership export. Source and
// target credentials are deliberately explicit so the app's live env cannot
// accidentally turn a migration around.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { AwsClient } from "aws4fetch";
import {createS3TransferProtocol,createReplitTransferProtocol} from "./media-transfer-protocol.mjs";

function argument(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function required(environment, name) {
  const value = environment[name];
  if (!value) throw new Error(`${name} is required for media transfer.`);
  return value;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function transferBinding(kind, location) {
  const identity = kind === "s3" ? { id: kind, endpoint: location.endpoint, bucket: location.bucket } : { id: kind, bucket: location.bucket };
  return Object.freeze({ kind, namespace: sha256(new TextEncoder().encode(JSON.stringify(identity))), location: Object.freeze(location) });
}

function checkedRevision(revision, key, binding, kind) {
  validateObjectKey(key);
  if (!revision || revision.kind !== kind || revision.key !== key || revision.namespace !== binding.namespace || typeof revision.value !== "string") {
    throw new Error("The deletion condition does not identify this exact original storage resource.");
  }
  if (kind === "etag" ? !/^"[\x21\x23-\x7e\x80-\xff]+"$/.test(revision.value) : !/^[1-9][0-9]{0,19}$/.test(revision.value)) {
    throw new Error("The original storage revision is unavailable or invalid.");
  }
  if(revision.versionId!==undefined&&(kind!=="etag"||typeof revision.versionId!=="string"||!revision.versionId||revision.versionId.length>4096||/[\u0000-\u001f\u007f]/.test(revision.versionId)))throw new Error("The exact original version identifier is invalid.");
  return revision.value;
}

function validateObjectKey(key) {
  if (typeof key !== "string" || !key || key.includes("\0") || key.split("/").some((part) => part === "." || part === "..")) {
    throw new Error("S3 object keys must not contain empty keys, NUL or dot path segments.");
  }
}

function s3ObjectUrl(endpoint, bucket, key, style) {
  validateObjectKey(key);
  const target = new URL(endpoint);
  const encodedKey = key.split("/").map(encodeURIComponent).join("/");
  if (style === "virtual") {
    target.hostname = `${bucket}.${target.hostname}`;
    target.pathname = `${target.pathname.replace(/\/+$/, "")}/${encodedKey}`;
  } else {
    target.pathname = `${target.pathname.replace(/\/+$/, "")}/${encodeURIComponent(bucket)}/${encodedKey}`;
  }
  return target.toString();
}

export function createS3Store(environment, prefix, { allowInsecureHttp = false, warn = console.warn } = {}) {
  const endpoint = required(environment, `${prefix}_S3_ENDPOINT`);
  const parsedEndpoint = new URL(endpoint);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(parsedEndpoint.hostname);
  const syntheticHttp = environment[`${prefix}_S3_ALLOW_LOOPBACK_HTTP`] === "true" && loopback;
  // The operator opt-out relaxes the scheme only; credentials in the URL and
  // every other scheme stay refused.
  const insecureHttp = allowInsecureHttp || environment.MEDIA_TRANSFER_ALLOW_INSECURE_HTTP === "true";
  const httpAllowed = parsedEndpoint.protocol === "http:" && (syntheticHttp || insecureHttp);
  if (parsedEndpoint.username || parsedEndpoint.password || parsedEndpoint.search || parsedEndpoint.hash ||
      (parsedEndpoint.protocol !== "https:" && !httpAllowed)) {
    throw new Error(`${prefix}_S3_ENDPOINT requires HTTPS without userinfo, query or fragment; plain HTTP needs --allow-insecure-http (or MEDIA_TRANSFER_ALLOW_INSECURE_HTTP=true).`);
  }
  if (parsedEndpoint.protocol === "http:" && !syntheticHttp) {
    warn(`WARNING: ${prefix}_S3_ENDPOINT uses plain HTTP (${parsedEndpoint.host}); media bytes and signed requests cross the network unencrypted.`);
  }
  const region = required(environment, `${prefix}_S3_REGION`);
  const bucket = required(environment, `${prefix}_S3_BUCKET`);
  const accessKeyId = required(environment, `${prefix}_S3_ACCESS_KEY_ID`);
  const secretAccessKey = required(environment, `${prefix}_S3_SECRET_ACCESS_KEY`);
  const style = environment[`${prefix}_S3_ADDRESSING_STYLE`] ?? "path";
  if (style !== "path" && style !== "virtual") {
    throw new Error(`${prefix}_S3_ADDRESSING_STYLE must be path or virtual.`);
  }
  // Stop on provider failure and let the operator resume after inspecting it.
  // In particular, an unsupported condition must not trigger ten more PUTs.
  const client = new AwsClient({ accessKeyId, secretAccessKey, region, service: "s3", retries: 0 });
  const url = (key) => s3ObjectUrl(endpoint, bucket, key, style);
  const binding = transferBinding("s3", { endpoint, bucket });
  return {
    binding,
    accounted(observer){return createS3TransferProtocol({client,url,binding,observer});},
    async readVersioned(key) {
      const response = await client.fetch(url(key), { redirect: "error", headers: { "accept-encoding": "identity" } });
      if (response.status === 404) return undefined;
      if (!response.ok) throw new Error(`${prefix}: versioned source read failed (${response.status}).`);
      const revision = { kind: "etag", key, namespace: binding.namespace, value: response.headers.get("etag") };
      checkedRevision(revision, key, binding, "etag");
      const body = new Uint8Array(await response.arrayBuffer());
      return { body, contentType: response.headers.get("content-type") ?? "application/octet-stream", revision };
    },
    async deleteVersioned(key, revision) {
      const value = checkedRevision(revision, key, binding, "etag");
      const target=new URL(url(key));if(revision.versionId!==undefined)target.searchParams.set("versionId",revision.versionId);
      const response = await client.fetch(target, { method: "DELETE", redirect: "error", headers: { "if-match": value } });
      if (!response.ok) throw new Error(`${prefix}: conditional source deletion failed (${response.status}).`);
    },
    async get(key) {
      const response = await client.fetch(url(key), { redirect: "error" });
      if (response.status === 404) return undefined;
      if (!response.ok) throw new Error(`${prefix}: GET ${key} failed (${response.status}).`);
      return new Uint8Array(await response.arrayBuffer());
    },
    async put(key, bytes, contentType) {
      const response = await client.fetch(url(key), {
        method: "PUT",
        redirect: "error",
        body: new Blob([bytes], { type: contentType }),
        headers: { "content-length": String(bytes.byteLength), "if-none-match": "*" },
      });
      if (!response.ok) throw new Error(`${prefix}: PUT ${key} failed (${response.status}).`);
    },
  };
}

export async function createReplitStore(environment, prefix) {
  // The Google client gives this ambient override precedence even over an
  // explicit API endpoint. It must not redirect an original-resource restore.
  const requireOriginalEndpoint = () => {
    if (environment.STORAGE_EMULATOR_HOST || process.env.STORAGE_EMULATOR_HOST) throw new Error(`${prefix}: Replit transfers refuse STORAGE_EMULATOR_HOST. Restore the original provider configuration.`);
  };
  requireOriginalEndpoint();
  const bucketId = required(environment, `${prefix}_REPLIT_BUCKET_ID`);
  const { Client } = await import("@replit/object-storage");
  requireOriginalEndpoint();
  const client = new Client({ bucketId });
  let writableBucket;
  const destination = () => (writableBucket ??= (async () => {
    // Pinned @replit/object-storage 1.0.0 uses this same official Google
    // client and platform credential broker. Its upload wrapper exposes no
    // generation precondition, so use the provider's supported create-only
    // API rather than an overwrite-capable wrapper. No ambient credentials
    // or default bucket may replace this explicit original resource.
    const { Storage } = await import("@google-cloud/storage");
    requireOriginalEndpoint();
    const google = new Storage({ projectId: "", retryOptions: { autoRetry: false, maxRetries: 0 }, credentials: {
      audience: "replit", subject_token_type: "access_token", type: "external_account",
      token_url: "http://127.0.0.1:1106/token", universe_domain: "googleapis.com",
      credential_source: { url: "http://127.0.0.1:1106/credential", format: { type: "json", subject_token_field_name: "access_token" } },
    } });
    return google.bucket(bucketId);
  })());
  const binding = transferBinding("replit", { bucket: bucketId });
  return {
    binding,
    accounted(observer){return createReplitTransferProtocol({destination,binding,requireOriginalEndpoint,observer});},
    async readVersioned(key) {
      validateObjectKey(key);
      const bucket = await destination();
      let metadata;
      try { [metadata] = await bucket.file(key).getMetadata(); }
      catch (error) {
        const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
        if (code === 404 || code === "404") return undefined;
        throw new Error(`${prefix}: original generation read failed (${code ?? "unclassified"}).`);
      }
      const revision = { kind: "generation", key, namespace: binding.namespace, value: String(metadata?.generation ?? "") };
      checkedRevision(revision, key, binding, "generation");
      // The body belongs to this exact generation, even if the live key changes.
      // A later body-read failure is never reinterpreted as current absence.
      let body;
      try { [body] = await bucket.file(key, { generation: revision.value }).download({ validation: false }); }
      catch (error) {
        const code = error && typeof error === "object" && "code" in error ? error.code : "unclassified";
        throw new Error(`${prefix}: original generation body read failed (${code}).`);
      }
      if (!Number.isSafeInteger(Number(metadata?.size)) || Number(metadata.size) !== body.byteLength) throw new Error(`${prefix}: original generation size changed.`);
      return { body: new Uint8Array(body), contentType: metadata.contentType ?? "application/octet-stream", revision };
    },
    async deleteVersioned(key, revision) {
      const value = checkedRevision(revision, key, binding, "generation");
      try { await (await destination()).file(key).delete({ ifGenerationMatch: value }); }
      catch (error) {
        const code = error && typeof error === "object" && "code" in error ? error.code : "unclassified";
        throw new Error(`${prefix}: conditional source deletion failed (${code}).`);
      }
    },
    async get(key) {
      const result = await client.downloadAsBytes(key);
      if (!result.ok) {
        if (result.error?.statusCode === 404) return undefined;
        throw new Error(`${prefix}: GET ${key} failed (${result.error?.statusCode ?? "unclassified"}).`);
      }
      if (!result.value) throw new Error(`${prefix}: GET ${key} omitted its successful result.`);
      return new Uint8Array(Buffer.concat(result.value));
    },
    async put(key, bytes, contentType) {
      try {
        // The SDK's checksum-error cleanup deletes by name without a
        // generation constraint. Never give it that authority: our caller
        // verifies the complete original and target SHA-256 independently.
        await (await destination()).file(key).save(Buffer.from(bytes), { validation: false, preconditionOpts: { ifGenerationMatch: 0 }, metadata: { contentType } });
      } catch (error) {
        const code = error && typeof error === "object" && "code" in error ? error.code : "unclassified";
        throw new Error(`${prefix}: create-only PUT ${key} failed (${code}).`);
      }
    },
  };
}

async function configuredStore(environment, prefix, options) {
  const kind = required(environment, `${prefix}_STORAGE`);
  if (kind === "s3") return createS3Store(environment, prefix, options);
  if (kind === "replit") return createReplitStore(environment, prefix);
  throw new Error(`${prefix}_STORAGE must be s3 or replit; local storage is not a Tier-1 migration target.`);
}

export async function copyManifestObjects({ manifest, source, target, dryRun = false }) {
  if (manifest?.format !== "freeholder-media-manifest/v1" || !Array.isArray(manifest.objects)) {
    throw new Error("Expected a freeholder-media-manifest/v1 ownership-export artifact.");
  }
  if (manifest.integrity?.missingInventoryKeys?.length) {
    throw new Error("The source media manifest has missing inventory keys; repair it before migration.");
  }
  const keys = new Set();
  const objects = manifest.objects.map((object) => {
    validateObjectKey(object.key);
    if (keys.has(object.key)) throw new Error(`Duplicate media object key: ${object.key}.`);
    keys.add(object.key);
    const known = [object.checksumSha256, ...(manifest.assets ?? [])
      .filter((asset) => asset.storageKey === object.key && (!object.assetId || asset.id === object.assetId))
      .map((asset) => asset.checksumSha256)]
      .filter((value) => value != null);
    if (known.some((value) => typeof value !== 'string' || !/^[0-9a-f]{64}$/i.test(value))) {
      throw new Error(`Invalid source checksum for ${object.key}.`);
    }
    const checksums = new Set(known.map((value) => value.toLowerCase()));
    if (checksums.size > 1) throw new Error(`Conflicting source checksums for ${object.key}.`);
    return { ...object, checksumSha256: [...checksums][0] };
  });
  let bytes = 0;
  let skipped = 0;
  const conflicts = [];
  for (const object of objects) {
    const body = await source.get(object.key);
    if (!body) throw new Error(`Source media object is missing: ${object.key}.`);
    if (Number(object.bytes) !== body.byteLength) {
      throw new Error(`Source media size differs for ${object.key}: manifest ${object.bytes}, object ${body.byteLength}.`);
    }
    const digest = sha256(body);
    if (object.checksumSha256 && digest !== object.checksumSha256) {
      throw new Error(`Source media checksum differs for ${object.key}.`);
    }
    bytes += body.byteLength;
    // Never overwrite: an object already at the key is either these exact
    // bytes (a resumed or repeated run) or something this transfer must not
    // destroy. Hash the full body; provider ETags are not SHA-256 and are
    // not even content hashes for multipart uploads.
    const existing = await target.get(object.key);
    if (existing) {
      if (existing.byteLength === body.byteLength && sha256(existing) === digest) {
        skipped++;
        continue;
      }
      if (!dryRun) {
        throw new Error(`Refusing to overwrite ${object.key}: the target already holds a different object there. Nothing was written for this key.`);
      }
      conflicts.push(object.key);
      continue;
    }
    if (!dryRun) {
      await target.put(object.key, body, object.contentType ?? "application/octet-stream");
      const restored = await target.get(object.key);
      if (!restored || restored.byteLength !== body.byteLength || sha256(restored) !== digest) {
        throw new Error(`Target byte verification failed for ${object.key}.`);
      }
    }
  }
  if (conflicts.length) {
    throw new Error(`Dry run: the target already holds different objects; a transfer would refuse to overwrite ${conflicts.join(", ")}.`);
  }
  return { objects: objects.length, bytes, dryRun, skipped };
}

async function main() {
  const manifestPath = argument("manifest", "ownership-export/media-manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const options = { allowInsecureHttp: process.argv.includes("--allow-insecure-http") };
  const [source, target] = await Promise.all([
    configuredStore(process.env, "SOURCE", options),
    configuredStore(process.env, "TARGET", options),
  ]);
  const result = await copyManifestObjects({
    manifest,
    source,
    target,
    dryRun: process.argv.includes("--dry-run"),
  });
  const copied = result.objects - result.skipped;
  console.log(result.dryRun
    ? `media transfer (dry run): read ${result.objects} objects (${result.bytes} bytes); would copy ${copied}, would skip ${result.skipped} already identical on the target`
    : `media transfer: copied and verified ${copied} objects, skipped ${result.skipped} already identical on the target (${result.objects} objects, ${result.bytes} bytes)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
