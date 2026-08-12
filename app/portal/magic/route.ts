// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
// A GET stores the credential and removes it from the URL; it does not consume
// it. Mail scanners may follow links, but they do not submit the confirmation.
import { CUSTOMER_MAGIC_COOKIE } from "@/core/auth/magic-links/service";
import { localePath } from "@/core/i18n/customer";

const LANGUAGE_TAG = /^[a-z]{2}(?:-[A-Za-z]{2,4})?$/;

export function GET(request: Request): Response {
  const incoming = new URL(request.url);
  const token = incoming.searchParams.get("token") ?? "";
  const asked = incoming.searchParams.get("locale") ?? "";
  const configured = incoming.searchParams.get("default") ?? "en";
  const fallback = LANGUAGE_TAG.test(configured) ? configured : "en";
  const locale = LANGUAGE_TAG.test(asked) ? asked : fallback;
  const target = new URL(
    localePath("portal/magic/confirm", locale, fallback),
    request.url,
  );
  const cookiePath = localePath("portal", locale, fallback);
  const response = new Response(null, {
    status: 303,
    headers: { location: target.toString() },
  });
  if (token.length >= 20 && token.length <= 200) {
    const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
    response.headers.append(
      "set-cookie",
      `${CUSTOMER_MAGIC_COOKIE}=${encodeURIComponent(token)}; Path=${cookiePath}; HttpOnly; SameSite=Strict; Max-Age=900${secure}`,
    );
  }
  response.headers.set("referrer-policy", "no-referrer");
  response.headers.set("cache-control", "no-store");
  return response;
}
