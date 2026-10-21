// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Popup HTTP-boundary values that must never become cross-origin navigation
// or misleading consent evidence.

export function localPopupPath(value: unknown, origin: string): string | null {
  if (typeof value !== "string" || !value.startsWith("/") || value.includes("\\")) {
    return null;
  }
  try {
    const parsed = new URL(value, origin);
    if (parsed.origin !== origin) return null;
    return `${parsed.pathname}${parsed.search}`.slice(0, 2_048);
  } catch {
    return null;
  }
}

export function popupAdminReturnTo(value: string): string {
  if (value === "/admin/popups") return value;
  return /^\/admin\/popups\/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(
    value,
  )
    ? value
    : "/admin/popups";
}
