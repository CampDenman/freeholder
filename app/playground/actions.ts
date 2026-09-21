// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { enterPlayground } from "@/core/demo/playground";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { CSRF_COOKIE, issueCsrfToken } from "@/core/http/csrf";
import { env } from "@/core/env";

export async function enterPlaygroundAction(): Promise<void> {
  const session = await enterPlayground.call({}, { kind: "anonymous" });
  const jar = await cookies();
  const options = { path: "/", secure: env().NODE_ENV === "production", sameSite: "lax" as const, expires: session.expiresAt };
  jar.set(SESSION_COOKIE, session.token, { ...options, httpOnly: true });
  jar.set(CSRF_COOKIE, issueCsrfToken(), options);
  redirect("/admin");
}
