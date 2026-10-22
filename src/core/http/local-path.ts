// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The one check for "a path on this site" before a redirect follows it
// (C11.10).
//
// `startsWith("/") && !startsWith("//")` is not that check. Browsers read a
// backslash as a slash and drop tabs and newlines from URLs, so `/\evil.test`
// and `/\t/evil.test` both leave the site. The answer here is decided the way
// a browser would decide it — by resolving against a placeholder origin and
// insisting the origin did not change — after refusing the characters that
// browsers rewrite before they resolve.
const BASE = "https://local.invalid";

export function safeLocalPath(value: unknown, fallback: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 2000) return fallback;
  if (!value.startsWith("/") || value.startsWith("//")) return fallback;
  // Backslashes, whitespace and control characters, raw or percent-encoded:
  // none belongs in a path this site generates, and each is a way to make a
  // browser or a decoding proxy read something other than what was checked.
  if (/[\\\x00-\x20\x7f]/.test(value) || /%(?:5c|2f%2f|0[0-9a-f]|1[0-9a-f]|7f)/i.test(value)) {
    return fallback;
  }
  try {
    const parsed = new URL(value, BASE);
    if (parsed.origin !== BASE) return fallback;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}
