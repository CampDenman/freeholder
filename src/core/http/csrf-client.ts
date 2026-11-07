// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0

/** Copy only the readable double-submit token, never an authentication cookie. */
export function browserCsrfHeaders(): Record<string, string> {
  const raw = document.cookie.split(/;\s*/).find(cookie => cookie.startsWith("freeholder_csrf="))?.slice("freeholder_csrf=".length);
  if (!raw) return {};
  try { return { "x-csrf-token": decodeURIComponent(raw) }; }
  catch { return {}; }
}
