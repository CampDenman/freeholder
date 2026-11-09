// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C10.32: explicit fresh-bucket initialization, never a guessed empty ledger.
import { AwsClient } from "aws4fetch";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { StorageQuotaError } from "./quota";
import type { S3Config } from "./s3";

async function boundedXML(response: Response): Promise<string> {
  if (!response.ok || !response.body) throw new StorageQuotaError("storage_quota_inventory_unavailable");
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let bytes = 0;
  try {
    for (;;) {
      const next = await reader.read(); if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > 65536) throw new StorageQuotaError("storage_quota_inventory_unavailable");
      chunks.push(next.value);
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  const xml = Buffer.concat(chunks).toString("utf8");
  if (/<!DOCTYPE|<!ENTITY|<!\[CDATA\[/i.test(xml)) throw new StorageQuotaError("storage_quota_inventory_unavailable");
  return xml;
}
function documentXML(xml:string):Record<string,unknown>{
  if (XMLValidator.validate(xml)!==true)throw new StorageQuotaError("storage_quota_inventory_unavailable");
  const parsed:unknown=new XMLParser({ignoreAttributes:true,parseTagValue:false,ignoreDeclaration:true,processEntities:false}).parse(xml);
  if(!parsed || typeof parsed!=="object" || Array.isArray(parsed))throw new StorageQuotaError("storage_quota_inventory_unavailable");
  return parsed as Record<string,unknown>;
}

/** The caller must have stopped other writers and use an instance-exclusive
 * credential. Both ordinary objects AND incomplete multipart uploads count.
 * A partial response, redirect, provider error or nonempty result refuses init.
 */
export async function verifyEmptyS3Inventory(config: S3Config, request: typeof fetch = fetch): Promise<void> {
  const endpoint = new URL(config.endpoint);
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.search || endpoint.hash
    || !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(config.bucket)) throw new StorageQuotaError("storage_quota_invalid_config");
  const client = new AwsClient({ accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey, service: "s3", region: config.region, retries: 0 });
  const url = new URL(endpoint);
  if (config.addressingStyle === "virtual") url.hostname = config.bucket + "." + url.hostname;
  else url.pathname = url.pathname.replace(/\/$/, "") + "/" + config.bucket;
  for (const multipart of [false, true]) {
    url.search = multipart ? "?uploads=&max-uploads=1" : "?list-type=2&max-keys=1&encoding-type=url";
    const signed = await client.sign(url.toString(), { method: "GET", redirect: "manual", signal: AbortSignal.timeout(15000) });
    const xml = await boundedXML(await request(signed));
    const document = documentXML(xml), root = multipart ? "ListMultipartUploadsResult" : "ListBucketResult";
    const value = document[root];
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new StorageQuotaError("storage_quota_inventory_unavailable");
    const result = value as Record<string,unknown>;
    if (Object.keys(document).length !== 1
      || result[multipart ? "Bucket" : "Name"] !== config.bucket || result.IsTruncated !== "false"
      || (multipart ? Object.hasOwn(result,"Upload") : result.KeyCount !== "0" || Object.hasOwn(result,"Contents"))) {
      throw new StorageQuotaError("storage_quota_inventory_not_empty");
    }
  }
  // Current-object accounting cannot bound retained versions/delete markers.
  // A bucket that ever enabled versioning is not a fresh empty namespace.
  url.search="?versioning=";
  const signed=await client.sign(url.toString(),{method:"GET",redirect:"manual",signal:AbortSignal.timeout(15000)});
  const versioning=documentXML(await boundedXML(await request(signed)));
  if(Object.keys(versioning).length!==1 || versioning.VersioningConfiguration!=="")throw new StorageQuotaError("storage_quota_versioning_not_disabled");
}
