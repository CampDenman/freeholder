// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.22: validate original source links before rewriting or retaining them.
export function safeImportHref(href: string, base: string): string | undefined {
  const candidate = href.trim();
  if (!candidate || /[\u0000-\u001f\u007f]/.test(candidate)) return undefined;
  try {
    const parsed = new URL(candidate, base);
    if (!["http:", "https:", "mailto:", "tel:"].includes(parsed.protocol) || parsed.username || parsed.password) return undefined;
    return candidate;
  } catch { return undefined; }
}
