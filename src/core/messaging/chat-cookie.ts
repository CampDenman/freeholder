// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { env } from "@/core/env";

export const SITE_CHAT_COOKIE = "freeholder_site_chat";
export const SITE_CHAT_MAX_AGE = 24 * 60 * 60;

export function siteChatCookie(token: string): string {
  const attributes = [
    `${SITE_CHAT_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${SITE_CHAT_MAX_AGE}`,
  ];
  if (env().NODE_ENV === "production") attributes.push("Secure");
  return attributes.join("; ");
}

export function clearedSiteChatCookie(): string {
  const attributes = [
    `${SITE_CHAT_COOKIE}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
  ];
  if (env().NODE_ENV === "production") attributes.push("Secure");
  return attributes.join("; ");
}
