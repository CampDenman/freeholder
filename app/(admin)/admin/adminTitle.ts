// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Per-screen document titles for the admin shell. A plain module on purpose:
// AdminNav is a client module, so the layout cannot read values out of it.
import type { AdminNavLabels } from "./AdminNav";

/** URL segments whose nav key is not simply the camel-cased segment. */
const SEGMENT_KEYS: Record<string, keyof AdminNavLabels> = {
  "": "overview",
  "price-lists": "prices",
  "print-on-demand": "printOnDemand",
  "voice-video": "voiceVideo",
};

/**
 * The nav label of the screen at `path`, by its first segment under /admin —
 * `/admin/products/42` is a Products screen. Null for a path outside the nav.
 */
export function adminScreenLabel(
  path: string,
  labels: AdminNavLabels,
): string | null {
  const match = /^\/admin(?:\/([^/?#]*))?/.exec(path);
  if (!match) return null;
  const segment = match[1] ?? "";
  const key =
    SEGMENT_KEYS[segment] ??
    segment.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
  if (key === "region" || !Object.hasOwn(labels, key)) return null;
  return labels[key as keyof AdminNavLabels];
}
