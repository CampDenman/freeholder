// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
// A GET stores the credential and removes it from the URL; it does not consume
// it. Mail scanners may follow links, but they do not submit the confirmation.
import { CUSTOMER_MAGIC_COOKIE } from "@/core/auth/magic-links/service";

export function GET(request: Request): Response {
  const token = new URL(request.url).searchParams.get("token") ?? "";
  const target = new URL("/portal/magic/confirm", request.url);
  const response = new Response(null, {
    status: 303,
    headers: { location: target.toString() },
  });
  if (token.length >= 20 && token.length <= 200) {
    const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
    response.headers.append(
      "set-cookie",
      `${CUSTOMER_MAGIC_COOKIE}=${encodeURIComponent(token)}; Path=/portal/magic; HttpOnly; SameSite=Strict; Max-Age=900${secure}`,
    );
  }
  response.headers.set("referrer-policy", "no-referrer");
  response.headers.set("cache-control", "no-store");
  return response;
}
