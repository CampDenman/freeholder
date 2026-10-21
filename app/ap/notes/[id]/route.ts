// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.18: one public post as a Note, only while it may federate.
import { federationDocument } from "@/modules/members/federation/core";
import { activity, ANONYMOUS, notFound } from "../../shared";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return notFound();
  if ((request.headers.get("accept") ?? "").includes("text/html")) return Response.redirect(new URL(`/p/${id}`, request.url), 303);
  const note = await federationDocument.call({ kind: "note", id }, ANONYMOUS);
  return note ? activity(note) : notFound();
}
