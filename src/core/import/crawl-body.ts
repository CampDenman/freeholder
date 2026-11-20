// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.47: read actual immutable HTTP originals through their physical receipt.
import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/core/db";
import { insideServiceTransaction } from "@/core/plugins/context";
import { originalStoredObject } from "@/core/media/write-ledger";
import { importRuns } from "@/core/plugins/schema";
import { ServiceError } from "@/core/service";
import { crawlOriginalFactsSchema } from "./crawl-original";
import { importCrawlRequests, importCrawlResponses, importCrawlSources } from "./crawl-schema";

export const crawlBodyDescriptorSchema = z.object({
  runId: z.uuid(), sourceId: z.uuid(), generation: z.uuid(), responseId: z.uuid(),
  digest: z.string().regex(/^[a-f0-9]{64}$/), bytes: z.number().int().min(0).max(20 * 1024 * 1024),
}).strict();
export type CrawlBodyDescriptor = z.infer<typeof crawlBodyDescriptorSchema>;

/** Only a current parent-authorized private phase supplies this descriptor.
 * Physical resolution may return a distinct verified key; source identities,
 * requested URLs and original namespace facts remain on their original rows. */
export async function readCrawlOriginalBody(raw: CrawlBodyDescriptor): Promise<Uint8Array<ArrayBuffer>> {
  if (insideServiceTransaction()) throw new ServiceError("internal", "Read original HTTP bodies outside the service transaction.");
  const input = crawlBodyDescriptorSchema.parse(raw);
  const [row] = await db().select({ source: importCrawlSources, request: importCrawlRequests, response: importCrawlResponses, rootStatus: importRuns.status }).from(importCrawlResponses)
    .innerJoin(importCrawlRequests, eq(importCrawlResponses.requestId, importCrawlRequests.id))
    .innerJoin(importCrawlSources, eq(importCrawlRequests.sourceId, importCrawlSources.id))
    .innerJoin(importRuns, eq(importCrawlSources.runId, importRuns.id))
    .where(and(eq(importCrawlResponses.id, input.responseId), eq(importCrawlSources.id, input.sourceId), eq(importCrawlSources.runId, input.runId), eq(importCrawlSources.generation, input.generation))).limit(1);
  if (!row || !["discovering", "sealed"].includes(row.source.state) || !["discover", "previewed"].includes(row.rootStatus) || row.source.expiresAt.getTime() <= Date.now() || !["fetched", "put_unknown", "stored"].includes(row.response.state) || row.response.retiredAt || !row.response.storageKey) throw new ServiceError("conflict", "The actual HTTP original was invalidated, expired or released.");
  const facts = crawlOriginalFactsSchema.parse(row.response.facts);
  if (facts.requestedUrl !== row.request.url || facts.role !== row.request.role || facts.digest !== input.digest || facts.bytes !== input.bytes) throw new ServiceError("conflict", "The original HTTP body lost its accepted source binding.");
  const captured = await originalStoredObject(row.response.storageKey);
  if (captured.store.isPublic || captured.receipt.sha256 !== facts.digest || captured.receipt.bytes !== facts.bytes) throw new ServiceError("conflict", "The original private HTTP response needs verified storage recovery.");
  const body = await captured.store.get(captured.key);
  if (!body || body.byteLength !== facts.bytes || createHash("sha256").update(body).digest("hex") !== facts.digest) throw new ServiceError("conflict", "The actual stored HTTP original is missing or changed.");
  return body;
}
