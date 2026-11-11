// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.30: Microsoft PhotoDNA Cloud Service. Free for qualifying
// organisations after Microsoft's review; the subscription key comes with
// that approval. The image is sent once and not retained by the site's code.
import { env } from "@/core/env";
import { readBoundedBytes } from "@/core/http/body";
import { z } from "zod";
import type { AbuseScanner } from "./types";

export interface PhotoDnaOptions {
  subscriptionKey?: string;
  endpoint?: string;
  fetch?: typeof fetch;
}

const SUPPORTED = new Set(["image/jpeg", "image/png", "image/gif", "image/bmp", "image/tiff"]);
const MAX_RESPONSE_BYTES = 256 * 1024;
const matchResponse = z.object({
  IsMatch: z.boolean(),
  Status: z.object({ Code: z.number().int() }),
  TrackingId: z.string().max(500).optional(),
  MatchDetails: z.object({ MatchFlags: z.array(z.object({ Source: z.string().max(500).optional() })).max(1000).optional() }).optional(),
});

export function createPhotoDna(options: PhotoDnaOptions = {}): AbuseScanner {
  const current = env();
  const key = options.subscriptionKey ?? current.PHOTODNA_SUBSCRIPTION_KEY;
  const endpoint = (options.endpoint ?? current.PHOTODNA_ENDPOINT).replace(/\/+$/, "");
  const fetcher = options.fetch ?? fetch;
  return {
    id: "photodna",
    missing: () => (key ? [] : ["PHOTODNA_SUBSCRIPTION_KEY"]),
    async match({ bytes, contentType }) {
      if (!key) throw new Error("PhotoDNA is not configured.");
      // Unsupported does not mean checked and clean. The composite scanner
      // keeps this upload quarantined, without creating match evidence.
      if (!SUPPORTED.has(contentType)) throw new Error("PhotoDNA cannot check this image format.");
      const signal = AbortSignal.timeout(20_000);
      const response = await fetcher(`${endpoint}/Match?enhance=false`, {
        method: "POST",
        headers: { "ocp-apim-subscription-key": key, "content-type": contentType },
        body: bytes,
        redirect: "error",
        signal,
      });
      let raw: unknown;
      try {
        const bytes = await readBoundedBytes(response, MAX_RESPONSE_BYTES, signal);
        raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
      } catch {
        throw new Error("PhotoDNA could not check the image.");
      }
      const parsed = matchResponse.safeParse(raw);
      if (!response.ok || !parsed.success || parsed.data.Status.Code !== 3000) throw new Error("PhotoDNA could not check the image.");
      const value = parsed.data;
      return { matched: value.IsMatch, matchId: value.TrackingId, source: value.MatchDetails?.MatchFlags?.[0]?.Source };
    },
  };
}
