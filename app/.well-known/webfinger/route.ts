// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.18: WebFinger (RFC 7033) for members who federate: acct:handle@this-site.
import { federationDocument, origin, siteHost } from "@/modules/members/federation/core";
import { ANONYMOUS } from "../../ap/shared";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const resource = new URL(request.url).searchParams.get("resource") ?? "";
  const match = /^acct:([a-z0-9_]{3,30})@(.+)$/i.exec(resource);
  let handle: string | null = null;
  if (match && match[2]!.toLowerCase() === siteHost().toLowerCase()) handle = match[1]!.toLowerCase();
  else if (resource.startsWith(`${origin()}/ap/users/`)) handle = resource.slice(`${origin()}/ap/users/`.length);
  if (!handle) return new Response(null, { status: 404 });
  const record = await federationDocument.call({ kind: "webfinger", handle }, ANONYMOUS);
  if (!record) return new Response(null, { status: 404 });
  return new Response(JSON.stringify(record), {
    headers: { "content-type": "application/jrd+json; charset=utf-8", "access-control-allow-origin": "*", "cache-control": "public, max-age=300" },
  });
}
