// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The packaged gallery, served through the session (C8.07).
//
// Same door as a single file: the session says who is asking, the service
// decides whether there is anything to give them, and the object key never
// reaches the browser.
import { cookies } from "next/headers";
import { storage } from "@/adapters/storage";
import { GALLERY_SESSION_COOKIE } from "@/modules/galleries/cookies";
import { downloadGalleryArchive } from "@/modules/galleries/service";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const token = (await cookies()).get(GALLERY_SESSION_COOKIE)?.value;
  if (!token) return new Response(null, { status: 404 });
  const allowed = await downloadGalleryArchive
    .call({ sessionToken: token }, { kind: "anonymous" })
    .catch(() => null);
  if (!allowed) return new Response(null, { status: 404 });
  const body = await storage().get(allowed.storageKey);
  if (!body) return new Response(null, { status: 404 });
  const safe = allowed.filename.replace(/[\r\n"]/g, "").slice(0, 180) || "gallery.zip";
  return new Response(body as BodyInit, {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="${safe}"`,
      "cache-control": "private, no-store",
      "x-robots-tag": "noindex, nofollow",
    },
  });
}
