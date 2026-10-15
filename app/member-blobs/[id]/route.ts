// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.36: one encrypted file, as ciphertext, only for people still in its
// conversation. Each request asks again, so leaving or unsending revokes it.
import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { storage } from "@/adapters/storage";
import { sealedBlobAccess } from "@/modules/members/sealed-blobs";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return new Response(null, { status: 404 });
  const actor = await actorFromToken((await cookies()).get(SESSION_COOKIE)?.value);
  const blob = await sealedBlobAccess.call({ id }, actor);
  if (!blob) return new Response(null, { status: 404 });
  const body = await storage().get(blob.storageKey);
  if (!body) return new Response(null, { status: 404 });
  return new Response(body as BodyInit, {
    headers: {
      "content-type": "application/octet-stream",
      "cache-control": "private, no-store",
      "content-security-policy": "default-src 'none'; sandbox",
      "x-content-type-options": "nosniff",
      "cross-origin-resource-policy": "same-origin",
    },
  });
}
