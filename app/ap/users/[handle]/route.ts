// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.18: a federating member's ActivityPub actor.
import { federationDocument } from "@/modules/members/federation/core";
import { activity, ANONYMOUS, notFound } from "../../shared";
import { originFor } from "@/core/seo/origin";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ handle: string }> }): Promise<Response> {
  const { handle } = await params;
  if ((request.headers.get("accept") ?? "").includes("text/html")) return Response.redirect(new URL(`/@${handle}`, originFor(request)), 303);
  const doc = await federationDocument.call({ kind: "actor", handle }, ANONYMOUS);
  return doc ? activity(doc) : notFound();
}
