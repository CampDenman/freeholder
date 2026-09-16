// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The tracked short link (MASTER.md §34, C9.28).
//
// A public redirect is the most abused shape on the web, so this route is
// deliberately almost empty: it asks `share.resolveLink` where to go and does
// what it is told, or 404s. Every rule that matters — the target must be a path
// this instance serves, the entity's sharing must still be switched on — lives
// in the service and in `modules/share/links.ts`, where a test can call it.
// A route handler nobody can call from a test is a bad place to keep a
// security decision.
//
// It writes nothing. The campaign parameters on the destination are the
// tracking: the page the visitor lands on records its own view through the
// analytics the platform already has, so a share click is counted by the same
// ledger, under the same consent rules, as every other visit.
import { NextResponse } from "next/server";
import { resolveLink } from "@/modules/share/service";

export const dynamic = "force-dynamic";

const ANONYMOUS = { kind: "anonymous" } as const;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ ref: string }> },
): Promise<Response> {
  const { ref } = await params;
  const found = await resolveLink.call({ ref }, ANONYMOUS).catch(() => null);
  // One answer for an unknown ref, a switched-off entity and a target that is
  // not ours. Distinguishing them would tell a stranger which refs exist.
  if (!found) {
    return new NextResponse("Not found", {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
  // 302, not 301: an owner may switch sharing off tomorrow, and a permanent
  // redirect is one browsers and proxies keep after we have stopped serving it.
  return NextResponse.redirect(found.destination, 302);
}
