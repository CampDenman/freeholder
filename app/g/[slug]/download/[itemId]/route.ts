// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Gallery downloads go through the session, not the public media door (C8.03).
import { cookies } from "next/headers";
import { storage } from "@/adapters/storage";
import { GALLERY_SESSION_COOKIE } from "@/modules/galleries/cookies";
import { downloadGalleryItem } from "@/modules/galleries/service";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string; itemId: string }>; },
): Promise<Response> {
  const { itemId } = await params;
  const token = (await cookies()).get(GALLERY_SESSION_COOKIE)?.value;
  if (!token) return new Response(null, { status: 404 });
  const allowed = await downloadGalleryItem
    .call({ sessionToken: token, itemId }, { kind: "anonymous" })
    .catch(() => null);
  if (!allowed) return new Response(null, { status: 404 });
  const body = await storage().get(allowed.storageKey);
  if (!body) return new Response(null, { status: 404 });
  const safe = allowed.filename.replace(/[\r\n"]/g, "").slice(0, 180) || "download";
  return new Response(body as BodyInit, {
    headers: {
      "content-type": "application/octet-stream",
      "content-disposition": `attachment; filename="${safe}"; filename*=UTF-8''${encodeURIComponent(allowed.filename)}`,
      "cache-control": "private, no-store",
      "x-robots-tag": "noindex, nofollow",
    },
  });
}
