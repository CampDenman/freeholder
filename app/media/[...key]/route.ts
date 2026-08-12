// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
// Controlled delivery for local and Replit storage. Every request re-checks
// the durable object inventory so trash/quarantine revokes a previously-known
// URL, and documents are always downloads rather than same-origin content.
import { storage } from "@/adapters/storage";
import { authorizeObjectDelivery } from "@/core/media/service";

export const dynamic = "force-dynamic";

const ANONYMOUS = { kind: "anonymous" } as const;

function attachment(filename: string): string {
  const safe = filename.replace(/[\r\n"]/g, "").slice(0, 180) || "download";
  return `attachment; filename="${safe}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ key: string[] }> },
): Promise<Response> {
  const { key } = await params;
  const path = key.join("/");
  const allowed = await authorizeObjectDelivery.call({ key: path }, ANONYMOUS);
  if (!allowed) return new Response(null, { status: 404 });

  const body = await storage().get(path);
  if (!body) return new Response(null, { status: 404 });
  const forceDownload =
    allowed.kind === "doc" ||
    allowed.contentType === "image/svg+xml" ||
    allowed.contentType === "text/html";

  return new Response(body as BodyInit, {
    headers: {
      "content-type": forceDownload
        ? "application/octet-stream"
        : allowed.contentType,
      // Lifecycle revocation matters more here than year-long immutable cache.
      "cache-control": "private, max-age=300",
      "content-security-policy": "default-src 'none'; sandbox",
      "x-content-type-options": "nosniff",
      ...(forceDownload
        ? { "content-disposition": attachment(allowed.filename) }
        : {}),
    },
  });
}
