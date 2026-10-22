// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C8.17: only local customer journeys may follow an email sign-in.
import { safeLocalPath } from "@/core/http/local-path";

export const CUSTOMER_RETURN_COOKIE = "freeholder_customer_return";
const CUSTOMER_JOURNEY = /^\/(?:[a-z]{2}(?:-[A-Za-z]{2,4})?\/)?(?:book|memberships|portal|checkout)(?:[/?]|$)/;

export function safeCustomerReturnPath(value: unknown): string {
  if (typeof value !== "string" || value.length > 1000 || !CUSTOMER_JOURNEY.test(value)) return "/portal";
  const local = safeLocalPath(value, "/portal");
  // Checked again after resolution, so `/portal/../admin` cannot step out.
  const parsed = new URL(local, "https://local.invalid");
  return CUSTOMER_JOURNEY.test(parsed.pathname) ? parsed.pathname + parsed.search : "/portal";
}
