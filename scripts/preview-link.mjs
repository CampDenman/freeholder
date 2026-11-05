#!/usr/bin/env node
// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.35: mint a signed private-preview link for an instance running with
// FREEHOLDER_PREVIEW_KEY. The key is read from the environment and never
// printed; only the link is. Same token format as src/core/preview/private-preview.ts.
//
//   FREEHOLDER_PREVIEW_KEY=… node scripts/preview-link.mjs --url https://preview.example --days 7 [--next /pricing]
import { createHmac } from "node:crypto";
import { fileURLToPath } from "node:url";

export const MAX_DAYS = 30;

export function previewToken(key, expiresAt) {
  if (typeof key !== "string" || key.length < 32) throw new Error("FREEHOLDER_PREVIEW_KEY must be at least 32 characters.");
  const sig = createHmac("sha256", key).update(`freeholder-private-preview:v1:${expiresAt}`).digest("base64url");
  return `v1.${expiresAt}.${sig}`;
}

export function previewLink(origin, key, { days = 7, now = Math.floor(Date.now() / 1000), next } = {}) {
  if (!(days > 0 && days <= MAX_DAYS)) throw new Error(`--days must be more than 0 and at most ${MAX_DAYS}.`);
  const url = new URL("/preview-access", new URL(origin).origin);
  const expiresAt = now + Math.floor(days * 86_400);
  url.searchParams.set("t", previewToken(key, expiresAt));
  if (next) url.searchParams.set("next", next);
  return { url: url.toString(), expiresAt };
}

function arg(name) {
  const at = process.argv.indexOf(`--${name}`);
  return at > -1 ? process.argv[at + 1] : undefined;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const origin = arg("url");
    if (!origin) throw new Error("Pass --url with the preview's origin.");
    const { url, expiresAt } = previewLink(origin, process.env.FREEHOLDER_PREVIEW_KEY, {
      days: Number(arg("days") ?? 7),
      next: arg("next"),
    });
    console.log(JSON.stringify({ url, expiresAt: new Date(expiresAt * 1000).toISOString() }));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(2);
  }
}
