// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Gallery images go through the session, not the public media door (C8.03).
//
// /media/{key} authorizes any attached, ready object for anyone who knows the
// key. That is right for a published page and wrong for a private delivery:
// it survives expiry, revoke and the per-asset view flag, and the key would
// have to be printed into the client's HTML to be used at all.
import { cookies } from "next/headers";
import { storage } from "@/adapters/storage";
import { GALLERY_SESSION_COOKIE } from "@/modules/galleries/cookies";
import { viewGalleryItem } from "@/modules/galleries/service";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string; itemId: string }> },
): Promise<Response> {
  const { itemId } = await params;
  const token = (await cookies()).get(GALLERY_SESSION_COOKIE)?.value;
  if (!token) return new Response(null, { status: 404 });
  const allowed = await viewGalleryItem
    .call({ sessionToken: token, itemId }, { kind: "anonymous" })
    .catch(() => null);
  if (!allowed) return new Response(null, { status: 404 });
  const body = await storage().get(allowed.storageKey);
  if (!body) return new Response(null, { status: 404 });
  // Same rule as the media door: anything that could execute same-origin is
  // handed over as a file rather than rendered.
  const inline = allowed.mime !== "image/svg+xml" && allowed.mime !== "text/html";
  const safe = allowed.filename.replace(/[\r\n"]/g, "").slice(0, 180) || "file";
  return new Response(body as BodyInit, {
    headers: {
      "content-type": inline ? allowed.mime : "application/octet-stream",
      ...(inline ? {} : { "content-disposition": `attachment; filename="${safe}"` }),
      // Short enough that a revoke or an expiry bites within the minute,
      // long enough that scrolling a gallery does not refetch every photo.
      "cache-control": "private, max-age=60",
      "content-security-policy": "default-src 'none'; sandbox",
      "x-content-type-options": "nosniff",
      "x-robots-tag": "noindex, nofollow",
    },
  });
}
