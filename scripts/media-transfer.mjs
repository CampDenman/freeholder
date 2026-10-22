// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Copy and byte-verify every object named by an ownership export. Source and
// target credentials are deliberately explicit so the app's live env cannot
// accidentally turn a migration around.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { AwsClient } from "aws4fetch";

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
  const client = new AwsClient({ accessKeyId, secretAccessKey, region, service: "s3" });
  const url = (key) => s3ObjectUrl(endpoint, bucket, key, style);
  return {
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
        headers: { "content-length": String(bytes.byteLength) },
      });
      if (!response.ok) throw new Error(`${prefix}: PUT ${key} failed (${response.status}).`);
    },
  };
}

async function createReplitStore(environment, prefix) {
  const bucketId = required(environment, `${prefix}_REPLIT_BUCKET_ID`);
  const { Client } = await import("@replit/object-storage");
  const client = new Client({ bucketId });
  return {
    async get(key) {
      const result = await client.downloadAsBytes(key);
      if (!result.ok || !result.value?.length) return undefined;
      return new Uint8Array(result.value[0]);
    },
    async put(key, bytes) {
      const result = await client.uploadFromBytes(key, Buffer.from(bytes));
      if (!result.ok) {
        throw new Error(`${prefix}: PUT ${key} failed (${result.error?.message ?? "unknown error"}).`);
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
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
