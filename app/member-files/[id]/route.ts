// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.21: one attached file, only for people who can see what it is attached
// to. The asset is private, so the public media route refuses it; this route
// asks `members.fileAccess` on every request, so deleting a post, leaving a
// conversation or being blocked revokes a URL someone already has.
import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { storage } from "@/adapters/storage";
import { fileAccess } from "@/modules/members/attachments";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return new Response(null, { status: 404 });
  const width = Number(new URL(request.url).searchParams.get("w")) || undefined;
  const actor = await actorFromToken((await cookies()).get(SESSION_COOKIE)?.value);
  const file = await fileAccess.call({ id, width: width && width <= 4096 ? width : undefined }, actor);
  if (!file) return new Response(null, { status: 404 });
  const body = await storage().get(file.key);
  if (!body) return new Response(null, { status: 404 });
  const safe = file.contentType.startsWith("image/") || file.contentType.startsWith("video/");
  return new Response(body as BodyInit, {
    headers: {
      "content-type": safe && file.contentType !== "image/svg+xml" ? file.contentType : "application/octet-stream",
      // Visibility can change at any moment: never let a shared cache keep it.
      "cache-control": "private, no-store",
      "content-security-policy": "default-src 'none'; sandbox",
      "x-content-type-options": "nosniff",
      "cross-origin-resource-policy": "same-origin",
    },
  });
}
