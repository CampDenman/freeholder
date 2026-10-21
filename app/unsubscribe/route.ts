// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// RFC 8058 one-click unsubscribe (C9.04).

import { NextResponse } from "next/server";
import { unsubscribeFromBroadcast, unsubscribeFromNewsletter } from "@/modules/newsletters/service";
import { readBoundedText, RequestBodyError } from "@/core/http/body";
import { mailLinkConfirmation } from "@/core/mail/link-confirmation";

export const dynamic = "force-dynamic";

const ANONYMOUS = { kind: "anonymous" } as const;

async function apply(token: string | null, broadcastToken: string | null) {
  if ((!token && !broadcastToken) || (token && broadcastToken)) return NextResponse.json({ error: "missing or ambiguous token" }, { status: 400 });
  if (broadcastToken) await unsubscribeFromBroadcast.call({ token: broadcastToken }, ANONYMOUS);
  else await unsubscribeFromNewsletter.call({ token: token! }, ANONYMOUS);
  return NextResponse.json({ unsubscribed: true });
}

export async function GET(request: Request) {
  return mailLinkConfirmation(request, "unsubscribe");
}

export async function POST(request: Request) {
  const url = new URL(request.url);
  const urlToken = url.searchParams.get("token");
  let bodyToken: string | null = null;
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/x-www-form-urlencoded")) {
    let body: string;
    try {
      body = await readBoundedText(request, 4_096);
    } catch (error) {
      const status = error instanceof RequestBodyError ? error.status : 400;
      return NextResponse.json({ error: "request body could not be read" }, { status });
    }
    const params = new URLSearchParams(body);
    if (params.get("List-Unsubscribe") !== "One-Click" && params.get("List-Unsubscribe") !== "one-click") {
      return NextResponse.json({ error: "expected List-Unsubscribe=One-Click" }, { status: 400 });
    }
    bodyToken = params.get("token");
  }
  try {
    return await apply(urlToken ?? bodyToken, url.searchParams.get("broadcastToken"));
  } catch {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
}
