// Copyright (C) 2026 Camp Denman Society
// SPDX-License-Identifier: AGPL-3.0-only
// Serving stored objects the app itself has to hand out.
//
// Only used when the storage adapter is not a public bucket — local disk in
// development, Replit Object Storage in that recipe. With S3 public, `url()`
// returns the object URL and a browser never reaches this route at all.
//
// Two things here are deliberate:
//
// Storage keys end in a random segment, so a given URL always names the same
// bytes and can be cached immutably for a year (§36: "CDN-friendly caching
// headers"). Replacing an image produces a new key, never a stale cache.
//
// The content type is echoed from what was stored, except that anything
// SVG-shaped is served as a download. An SVG is a document that can carry
// script, and serving one inline from the site's own origin would hand an
// uploader a cross-site scripting vector.
import { storage } from "@/adapters/storage";

export const dynamic = "force-dynamic";

const TYPES: Record<string, string> = {
  avif: "image/avif",
  webp: "image/webp",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  pdf: "application/pdf",
  mp4: "video/mp4",
  webm: "video/webm",
  mp3: "audio/mpeg",
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ key: string[] }> },
): Promise<Response> {
  const { key } = await params;
  const path = key.join("/");

  const bytes = await storage().get(path);
  if (!bytes) return new Response(null, { status: 404 });

  const extension = path.split(".").pop()?.toLowerCase() ?? "";
  const isSvg = extension === "svg";
  const contentType = isSvg
    ? "application/octet-stream"
    : (TYPES[extension] ?? "application/octet-stream");

  return new Response(bytes as BodyInit, {
    headers: {
      "content-type": contentType,
      "cache-control": "public, max-age=31536000, immutable",
      // Belt and braces alongside the content type above.
      "content-security-policy": "default-src 'none'; sandbox",
      ...(isSvg ? { "content-disposition": "attachment" } : {}),
    },
  });
}
