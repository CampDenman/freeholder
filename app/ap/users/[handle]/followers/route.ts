// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.18: a federating member's ActivityPub followers.
import { federationDocument } from "@/modules/members/federation/core";
import { activity, ANONYMOUS, notFound } from "../../../shared";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ handle: string }> }): Promise<Response> {
  const { handle } = await params;
  const doc = await federationDocument.call({ kind: "followers", handle }, ANONYMOUS);
  return doc ? activity(doc) : notFound();
}
