// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Branding, pulled from the instance rather than compiled in (MASTER.md §35).
//
// §35: "branded home (colors/logo/fonts pulled from instance settings)". The
// app is white-label, so the brand arrives at runtime from the discovery
// document — which means a rebrand reaches every phone the next time the app
// opens, without a store review.
//
// The tokens are the platform's own semantic ones (§43's design rule), so the
// app never invents a colour and never has to know which of them the owner
// overrode. Where a token is missing, the fallback is a neutral that works on
// both grounds — never a guess at the brand, because a wrong brand colour
// looks like a bug in the business rather than a gap in the app.
import type { Instance } from "./discovery.js";

export interface Brand {
  name: string;
  tagline: string | null;
  logoUrl: string | null;
  fontSans: string | null;
  colors: {
    surface: string;
    ink: string;
    inkMuted: string;
    accent: string;
    onAccent: string;
    danger: string;
    rule: string;
  };
  /** Whether the instance actually supplied a palette, for an honest fallback. */
  branded: boolean;
}

/**
 * Unbranded fallback, copied from the platform light tokens so the package
 * never invents a palette. Contrast is proven in tests/core/colour-literals.test.ts.
 */
export const FALLBACK_COLORS: Brand["colors"] = {
  surface: "#ffffff",
  ink: "#23262a",
  inkMuted: "#5a5f66",
  accent: "#2551e0",
  onAccent: "#ffffff",
  danger: "#b3261e",
  rule: "#e3e3de",
};

/** Dark counterpart of FALLBACK_COLORS, for a scheme the instance did not brand. */
export const FALLBACK_COLORS_DARK: Brand["colors"] = {
  surface: "#191b1f",
  ink: "#eceef0",
  inkMuted: "#9aa0a8",
  accent: "#5c86ff",
  onAccent: "#0d1016",
  danger: "#f08d85",
  rule: "#2b2e34",
};

const NEUTRAL = FALLBACK_COLORS;

function pick(colors: Record<string, string>, ...names: string[]): string | null {
  for (const name of names) {
    const value = colors[name];
    if (typeof value === "string" && /^#|^rgb|^oklch|^hsl/i.test(value.trim())) return value;
  }
  return null;
}

export function brandFrom(instance: Instance): Brand {
  const colors = instance.branding.colors ?? {};
  const resolved = {
    surface: pick(colors, "surface", "background", "bg") ?? NEUTRAL.surface,
    ink: pick(colors, "ink", "foreground", "text") ?? NEUTRAL.ink,
    inkMuted: pick(colors, "inkMuted", "ink-muted", "muted") ?? NEUTRAL.inkMuted,
    accent: pick(colors, "accent", "primary", "brand") ?? NEUTRAL.accent,
    onAccent: pick(colors, "onAccent", "on-accent") ?? NEUTRAL.onAccent,
    danger: pick(colors, "danger", "destructive", "error") ?? NEUTRAL.danger,
    rule: pick(colors, "rule", "border") ?? NEUTRAL.rule,
  };
  return {
    name: instance.name,
    tagline: instance.tagline,
    logoUrl: instance.branding.logoUrl,
    fontSans: instance.branding.fontSans,
    colors: resolved,
    branded: Object.values(resolved).some(
      (value, index) => value !== Object.values(NEUTRAL)[index],
    ),
  };
}
