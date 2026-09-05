// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// RFC 8058 one-click unsubscribe (C9.04).

import { NextResponse } from "next/server";
import { unsubscribeFromNewsletter } from "@/modules/newsletters/service";
import { readBoundedText, RequestBodyError } from "@/core/http/body";

export const dynamic = "force-dynamic";

const ANONYMOUS = { kind: "anonymous" } as const;

async function apply(token: string | null) {
  if (!token) return NextResponse.json({ error: "missing token" }, { status: 400 });
  await unsubscribeFromNewsletter.call({ token }, ANONYMOUS);
  return NextResponse.json({ unsubscribed: true });
}

export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token");
  try {
    await apply(token);
    return new NextResponse("You have been unsubscribed.", {
      status: 200,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  } catch {
    return new NextResponse("That unsubscribe link is not valid.", { status: 404 });
  }
}

export async function POST(request: Request) {
  const urlToken = new URL(request.url).searchParams.get("token");
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
    return await apply(urlToken ?? bodyToken);
  } catch {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
}
