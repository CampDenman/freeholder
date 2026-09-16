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

function s3ObjectUrl(endpoint, bucket, key, style) {
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

function createS3Store(environment, prefix) {
  const endpoint = required(environment, `${prefix}_S3_ENDPOINT`);
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
      const response = await client.fetch(url(key));
      if (response.status === 404) return undefined;
      if (!response.ok) throw new Error(`${prefix}: GET ${key} failed (${response.status}).`);
      return new Uint8Array(await response.arrayBuffer());
    },
    async put(key, bytes, contentType) {
      const response = await client.fetch(url(key), {
        method: "PUT",
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

async function configuredStore(environment, prefix) {
  const kind = required(environment, `${prefix}_STORAGE`);
  if (kind === "s3") return createS3Store(environment, prefix);
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
  const objects = [...new Map(manifest.objects.map((item) => [item.key, item])).values()];
  let bytes = 0;
  for (const object of objects) {
    const body = await source.get(object.key);
    if (!body) throw new Error(`Source media object is missing: ${object.key}.`);
    if (Number(object.bytes) !== body.byteLength) {
      throw new Error(`Source media size differs for ${object.key}: manifest ${object.bytes}, object ${body.byteLength}.`);
    }
    if (!dryRun) {
      await target.put(object.key, body, object.contentType ?? "application/octet-stream");
      const restored = await target.get(object.key);
      if (!restored || restored.byteLength !== body.byteLength || sha256(restored) !== sha256(body)) {
        throw new Error(`Target byte verification failed for ${object.key}.`);
      }
    }
    bytes += body.byteLength;
  }
  return { objects: objects.length, bytes, dryRun };
}

async function main() {
  const manifestPath = argument("manifest", "ownership-export/media-manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const [source, target] = await Promise.all([
    configuredStore(process.env, "SOURCE"),
    configuredStore(process.env, "TARGET"),
  ]);
  const result = await copyManifestObjects({
    manifest,
    source,
    target,
    dryRun: process.argv.includes("--dry-run"),
  });
  console.log(`media transfer: ${result.dryRun ? "read" : "copied and verified"} ${result.objects} objects (${result.bytes} bytes)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
