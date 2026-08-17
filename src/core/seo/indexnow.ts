// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// IndexNow (MASTER.md §5, BigDataSEO.com §3.4).
//
// A published or moved URL is submitted once, in a delta, to any IndexNow
// participant (Bing is the primary). Unchanged URLs are not resent. Local
// and private hosts are never submitted — a ping of localhost teaches the
// engine nothing and burns the instance's reputation with the endpoint.
import { createHash } from "node:crypto";
import { env } from "@/core/env";
import { siteOrigin } from "@/core/seo/origin";
import { absoluteUrl } from "@/core/seo/meta";

export const INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow";
export const INDEXNOW_BATCH = 10_000;

const LOCAL_HOST = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])$/i;

export function indexNowKey(): string {
  const material = env().SESSION_SECRET ?? env().APP_URL;
  return createHash("sha256")
    .update(`freeholder:indexnow:${material}`)
    .digest("hex")
    .slice(0, 32);
}

export function indexNowKeyLocation(origin = siteOrigin()): string {
  return `${origin}/${indexNowKey()}.txt`;
}

export function isIndexablePublicHost(originOrUrl: string): boolean {
  try {
    const host = new URL(originOrUrl).hostname;
    return !LOCAL_HOST.test(host);
  } catch {
    return false;
  }
}

export function indexNowPayload(urls: string[], origin = siteOrigin()) {
  const host = new URL(origin).host;
  return {
    host,
    key: indexNowKey(),
    keyLocation: indexNowKeyLocation(origin),
    urlList: urls,
  };
}

export async function submitIndexNow(
  urls: string[],
  options: { origin?: string; fetchImpl?: typeof fetch } = {},
): Promise<{ submitted: number; skipped: boolean; batches: number }> {
  const origin = options.origin ?? siteOrigin();
  const fetchImpl = options.fetchImpl ?? fetch;
  const unique = [...new Set(urls)].filter((url) => isIndexablePublicHost(url));

  if (unique.length === 0 || !isIndexablePublicHost(origin)) {
    return { submitted: 0, skipped: true, batches: 0 };
  }

  let submitted = 0;
  let batches = 0;
  for (let offset = 0; offset < unique.length; offset += INDEXNOW_BATCH) {
    const batch = unique.slice(offset, offset + INDEXNOW_BATCH);
    const response = await fetchImpl(INDEXNOW_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify(indexNowPayload(batch, origin)),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(
        `IndexNow responded ${response.status}${body ? `: ${body.slice(0, 200)}` : ""}`,
      );
    }
    submitted += batch.length;
    batches += 1;
  }
  return { submitted, skipped: false, batches };
}

type Queueable = {
  queueJob: (
    name: string,
    data?: Record<string, unknown>,
    options?: { idempotencyKey?: string },
  ) => Promise<unknown>;
};

/**
 * Enqueue a delta ping. No-ops on localhost so a development save does not
 * open a job or a network call, and so tests that publish pages do not
 * grow a queue of submissions nobody will send.
 */
export async function queueIndexNow(
  ctx: Queueable,
  slugs: string[],
  idempotencyKey: string,
  origin = siteOrigin(),
): Promise<void> {
  if (!isIndexablePublicHost(origin)) return;
  const urls = [...new Set(slugs.map((slug) => absoluteUrl(origin, slug)))];
  if (urls.length === 0) return;
  await ctx.queueJob("seo.submitIndexNow", { urls }, { idempotencyKey });
}
