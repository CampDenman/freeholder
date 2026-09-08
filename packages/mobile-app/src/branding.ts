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

/** Neutral, legible on both grounds, and obviously not anybody's brand. */
const NEUTRAL: Brand["colors"] = {
  surface: "#ffffff",
  ink: "#16181d",
  inkMuted: "#5b6270",
  accent: "#2f5fd0",
  onAccent: "#ffffff",
  danger: "#a4232b",
  rule: "#dfe2e8",
};

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
