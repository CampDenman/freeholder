// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.30: Microsoft PhotoDNA Cloud Service. Free for qualifying
// organisations after Microsoft's review; the subscription key comes with
// that approval. The image is sent once and not retained by the site's code.
import { env } from "@/core/env";
import type { AbuseScanner } from "./types";

export interface PhotoDnaOptions {
  subscriptionKey?: string;
  endpoint?: string;
  fetch?: typeof fetch;
}

const SUPPORTED = new Set(["image/jpeg", "image/png", "image/gif", "image/bmp", "image/tiff"]);

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
      // Formats PhotoDNA cannot read are still scanned for malware, but cannot be matched here.
      if (!SUPPORTED.has(contentType)) return { matched: false };
      const response = await fetcher(`${endpoint}/Match?enhance=false`, {
        method: "POST",
        headers: { "ocp-apim-subscription-key": key, "content-type": contentType },
        body: bytes,
        redirect: "error",
        signal: AbortSignal.timeout(20_000),
      });
      const value = (await response.json().catch(() => null)) as { IsMatch?: boolean; TrackingId?: string; Status?: { Code?: number; Description?: string }; MatchDetails?: { MatchFlags?: { Source?: string }[] } } | null;
      if (!response.ok || !value || (value.Status?.Code !== undefined && value.Status.Code !== 3000)) {
        throw new Error(`PhotoDNA could not check the image (${value?.Status?.Description ?? response.status}).`);
      }
      return { matched: value.IsMatch === true, matchId: value.TrackingId, source: value.MatchDetails?.MatchFlags?.[0]?.Source };
    },
  };
}
