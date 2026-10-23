// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Paradise Modern as one optional provider (MASTER.md §12, C3.31–C3.34).
//
// Freeholder presents every outside service as a neutral category — mail,
// measurement, form screening, lead sink, model gateway — with swappable
// adapters. Paradise Modern is one adapter in several of those categories,
// configured like any other provider: a server-side site key and, where a
// category needs one, a provider-specific setting. Nothing here is on until
// the owner chooses Paradise for a category, so a site that never names it
// never contacts it.
import { env } from "@/core/env";

export const PARADISE_DEFAULT_URL = "https://paradisemodern.com";

/**
 * Normalize `PARADISEMODERN_URL` to the base every API path is appended to.
 *
 * Operators have written it both with and without a trailing `/v1`; the
 * paths Freeholder calls live on both sides of that prefix and name it
 * themselves, so a trailing `/v1` (and any trailing slash) is dropped.
 */
export function paradiseBaseUrl(raw: string | undefined = env().PARADISEMODERN_URL): string {
  return (raw?.trim() || PARADISE_DEFAULT_URL).replace(/\/+$/, "").replace(/\/v1$/i, "");
}

export interface ParadiseSite {
  apiKey: string | undefined;
  /** API base with no trailing slash and no `/v1` suffix. */
  baseUrl: string;
}

export function paradiseSite(): ParadiseSite {
  const current = env();
  return { apiKey: current.PARADISEMODERN_API_KEY, baseUrl: paradiseBaseUrl(current.PARADISEMODERN_URL) };
}

/**
 * The project header Paradise's model gateway meters a call against.
 *
 * Paradise answers a gateway call that names no project it knows with HTTP
 * 400, so the builder and workforce send `PARADISEMODERN_PROJECT` whenever
 * it is set. Other providers never receive it.
 */
export function paradiseProjectHeaders(): Record<string, string> {
  const project = env().PARADISEMODERN_PROJECT;
  return project ? { "x-pm-project": project } : {};
}
