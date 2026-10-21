// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Visitor choice for third-party ad tags (MASTER.md §4.16, C9.20).
//
// Separate from `/api/analytics/consent`: creative code is a different risk
// (C1.19), and only `fh_tc=granted` opens the CSP origin allowlist. Implicit
// first-party analytics consent never implies this.
import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/core/env";
import { THIRD_PARTY_CREATIVE_CONSENT_COOKIE } from "@/core/http/csp";
import { readBoundedText, RequestBodyError } from "@/core/http/body";

const MAX_AGE = 60 * 60 * 24 * 365;

function safeReturnTo(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/")) return "/";
  try {
    const base = "https://freeholder-return.invalid";
    const parsed = new URL(value.slice(0, 4000), base);
    return parsed.origin === base ? `${parsed.pathname}${parsed.search}` : "/";
  } catch {
    return "/";
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const fetchSite = request.headers.get("sec-fetch-site");
  const origin = request.headers.get("origin");
  const allowedOrigins = new Set([
    request.nextUrl.origin,
    new URL(env().APP_URL).origin,
  ]);
  if (
    fetchSite === "cross-site" ||
    (origin !== null && !allowedOrigins.has(origin))
  ) {
    return NextResponse.json({ error: "Cross-site third-party ads choice refused." }, { status: 403 });
  }

  let raw: string;
  try {
    raw = await readBoundedText(request, 4_096);
  } catch (error) {
    const status = error instanceof RequestBodyError ? error.status : 400;
    return NextResponse.json({ error: "Choice payload could not be read." }, { status });
  }
  const form = new URLSearchParams(raw);
  const decision = form.get("decision");
  const state = decision === "grant" ? "granted" : decision === "deny" ? "denied" : null;
  if (!state) {
    return NextResponse.json({ error: "Choose allow or decline." }, { status: 400 });
  }

  const returnTo = safeReturnTo(form.get("returnTo"));
  const response = NextResponse.redirect(new URL(returnTo, request.url), 303);
  response.cookies.set(THIRD_PARTY_CREATIVE_CONSENT_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: request.nextUrl.protocol === "https:",
    path: "/",
    maxAge: MAX_AGE,
  });
  return response;
}
