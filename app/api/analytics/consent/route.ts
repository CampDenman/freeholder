// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Reconcile one browser with the instance analytics policy (MASTER C1.18).
import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/core/env";
import { currentAnalyticsSettings } from "@/modules/analytics/read";
import {
  ANALYTICS_BOOTSTRAP_COOKIE,
  ANALYTICS_CONSENT_COOKIE,
  ANALYTICS_CONSENT_MAX_AGE,
  ANON_COOKIE,
  ANON_MAX_AGE,
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE,
  analyticsIdentifiersAllowed,
  newVisitorId,
  parseAnalyticsConsentState,
  type AnalyticsConsentState,
} from "@/modules/analytics/visitor";
import { readBoundedText, RequestBodyError } from "@/core/http/body";

type Decision = "sync" | "grant" | "deny";

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

function inputOf(raw: string, type: string): {
  decision: Decision;
  returnTo: string;
  redirect: boolean;
} {
  if (type.includes("application/json")) {
    let body: Record<string, unknown> = {};
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        body = parsed as Record<string, unknown>;
      }
    } catch {
      // Malformed input reconciles policy instead of changing a choice.
    }
    const decision = body.decision;
    return {
      decision: decision === "grant" || decision === "deny" ? decision : "sync",
      returnTo: safeReturnTo(body.returnTo),
      redirect: false,
    };
  }
  const form = new URLSearchParams(raw);
  const decision = form.get("decision");
  return {
    decision: decision === "grant" || decision === "deny" ? decision : "sync",
    returnTo: safeReturnTo(form.get("returnTo")),
    redirect: true,
  };
}

function resolvedState(
  decision: Decision,
  policy: "privacy_first" | "opt_in" | "disabled",
  current: AnalyticsConsentState | null,
): AnalyticsConsentState {
  if (policy === "disabled") return "disabled";
  if (decision === "deny") return "denied";
  if (decision === "grant") return "granted";
  if (policy === "opt_in") {
    return current === "granted" || current === "denied" ? current : "pending";
  }
  if (current === "denied") return "denied";
  return current === "granted" ? "granted" : "implicit";
}

function clear(response: NextResponse, name: string, secure: boolean): void {
  response.cookies.set(name, "", {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: 0,
  });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  // A cross-site form has no legitimate reason to change this browser choice.
  const fetchSite = request.headers.get("sec-fetch-site");
  const origin = request.headers.get("origin");
  // Behind a reverse proxy, Next's request URL can carry the loopback
  // container origin while the browser correctly sends the public HTTPS
  // origin. APP_URL is the instance's canonical, operator-controlled origin;
  // accepting it keeps same-origin reconciliation working without trusting a
  // caller-supplied forwarded header.
  const allowedOrigins = new Set([
    request.nextUrl.origin,
    new URL(env().APP_URL).origin,
  ]);
  if (
    fetchSite === "cross-site" ||
    (origin !== null && !allowedOrigins.has(origin))
  ) {
    return NextResponse.json({ error: "Cross-site analytics choice refused." }, { status: 403 });
  }

  let raw: string;
  try {
    raw = await readBoundedText(request, 16_384);
  } catch (error) {
    const status = error instanceof RequestBodyError ? error.status : 400;
    return NextResponse.json({ error: "Analytics choice payload could not be read." }, { status });
  }
  const settings = await currentAnalyticsSettings();
  const { decision, returnTo, redirect } = inputOf(
    raw,
    request.headers.get("content-type") ?? "",
  );
  const current = parseAnalyticsConsentState(
    request.cookies.get(ANALYTICS_CONSENT_COOKIE)?.value,
  );
  const state = resolvedState(decision, settings.consentPolicy, current);
  const response = redirect
    ? NextResponse.redirect(new URL(returnTo, request.url), 303)
    : NextResponse.json({ state, enabled: analyticsIdentifiersAllowed(state) });
  const secure = request.nextUrl.protocol === "https:";

  response.cookies.set(ANALYTICS_CONSENT_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: ANALYTICS_CONSENT_MAX_AGE,
  });

  if (analyticsIdentifiersAllowed(state)) {
    const bootstrap = request.cookies.get(ANALYTICS_BOOTSTRAP_COOKIE)?.value;
    const anon = request.cookies.get(ANON_COOKIE)?.value ?? bootstrap ?? newVisitorId();
    const session = request.cookies.get(SESSION_COOKIE_NAME)?.value ?? bootstrap ?? newVisitorId();
    response.cookies.set(ANON_COOKIE, anon, {
      httpOnly: true,
      sameSite: "lax",
      secure,
      path: "/",
      maxAge: Math.min(ANON_MAX_AGE, settings.retentionDays * 86_400),
    });
    response.cookies.set(SESSION_COOKIE_NAME, session, {
      httpOnly: true,
      sameSite: "lax",
      secure,
      path: "/",
      maxAge: SESSION_MAX_AGE,
    });
    clear(response, ANALYTICS_BOOTSTRAP_COOKIE, secure);
  } else {
    clear(response, ANON_COOKIE, secure);
    clear(response, SESSION_COOKIE_NAME, secure);
    if (state === "denied" || state === "disabled") {
      clear(response, ANALYTICS_BOOTSTRAP_COOKIE, secure);
    }
  }

  return response;
}
