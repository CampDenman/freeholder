// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { findMeStillContactId } from "@/core/findmestill/discovery";
import { readPublishedFindMeStillDesk } from "@/core/findmestill/service";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ identity: string }> }) {
  const identity = findMeStillContactId.safeParse((await context.params).identity);
  const document = identity.success
    ? await readPublishedFindMeStillDesk.call({ identity: identity.data }, { kind: "anonymous" })
    : null;
  return new Response(document, {
    status: document === null ? 404 : 200,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
