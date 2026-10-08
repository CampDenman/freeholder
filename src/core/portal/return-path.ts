// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C8.17: only local customer journeys may follow an email sign-in.
export const CUSTOMER_RETURN_COOKIE = "freeholder_customer_return";
export function safeCustomerReturnPath(value: unknown): string {
  if (typeof value !== "string" || value.length > 1000 || /[\\\x00-\x20]/.test(value) || value.startsWith("//")) return "/portal";
  if (!/^\/(?:[a-z]{2}(?:-[A-Za-z]{2,4})?\/)?(?:book|memberships|portal|checkout)(?:[/?]|$)/.test(value)) return "/portal";
  try { const parsed = new URL(value, "https://local.invalid"); return parsed.origin === "https://local.invalid" && /^\/(?:[a-z]{2}(?:-[A-Za-z]{2,4})?\/)?(?:book|memberships|portal|checkout)(?:[/?]|$)/.test(parsed.pathname) ? parsed.pathname + parsed.search : "/portal"; } catch { return "/portal"; }
}
