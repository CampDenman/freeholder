// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.18: a federating member's ActivityPub actor.
import { federationDocument } from "@/modules/members/federation/core";
import { activity, ANONYMOUS, notFound } from "../../shared";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ handle: string }> }): Promise<Response> {
  const { handle } = await params;
  if ((request.headers.get("accept") ?? "").includes("text/html")) return Response.redirect(new URL(`/@${handle}`, request.url), 303);
  const doc = await federationDocument.call({ kind: "actor", handle }, ANONYMOUS);
  return doc ? activity(doc) : notFound();
}
