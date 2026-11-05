// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The private-preview gate for routes proxy.ts does not run on (C3.35).
//
// proxy.ts's matcher skips robots.txt and sitemap.xml, so the sitemap index
// checks the preview cookie itself. Same token, same key, same refusal.
import { env } from "@/core/env";
import {
  PREVIEW_COOKIE,
  PREVIEW_REQUIRED_HTML,
  PREVIEW_ROBOTS_HEADER,
  previewEnabled,
  verifyPreviewToken,
} from "./private-preview";

function cookieValue(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return undefined;
}

/** A 401 for a request without a current preview cookie; null otherwise or when preview is off. */
export function previewRefusal(request: Request): Response | null {
  const key = env().FREEHOLDER_PREVIEW_KEY;
  if (!previewEnabled(key)) return null;
  const token = cookieValue(request.headers.get("cookie"), PREVIEW_COOKIE);
  if (verifyPreviewToken(key, token)) return null;
  return new Response(PREVIEW_REQUIRED_HTML, {
    status: 401,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-robots-tag": PREVIEW_ROBOTS_HEADER,
    },
  });
}

/** A preview's responses are for one viewer: never cached by a shared cache. */
export function previewCacheControl(published: string): string {
  return previewEnabled(env().FREEHOLDER_PREVIEW_KEY) ? "private, no-store" : published;
}

/** The noindex header every preview response carries. */
export function previewHeaders(): Record<string, string> {
  return previewEnabled(env().FREEHOLDER_PREVIEW_KEY) ? { "x-robots-tag": PREVIEW_ROBOTS_HEADER } : {};
}
