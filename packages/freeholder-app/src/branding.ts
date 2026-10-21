// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Brand tokens for store assets, from the public discovery document.
export interface Branding {
  url: string;
  name: string;
  tagline: string | null;
  colors: {
    surface: string;
    ink: string;
    accent: string;
    onAccent: string;
  };
  rgb: {
    surface: Rgb;
    ink: Rgb;
    accent: Rgb;
    onAccent: Rgb;
  };
  logoUrl: string | null;
  locales: { default: string; enabled: string[] };
  country: string;
}

export type Rgb = readonly [number, number, number];

const NEUTRAL = {
  surface: "#ffffff",
  ink: "#16181d",
  accent: "#2f5fd0",
  onAccent: "#ffffff",
} as const;

export function parseHex(value: unknown): Rgb | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(trimmed);
  if (!hex) return null;
  const raw = hex[1]!;
  if (raw.length === 3) {
    return [
      Number.parseInt(raw[0]! + raw[0]!, 16),
      Number.parseInt(raw[1]! + raw[1]!, 16),
      Number.parseInt(raw[2]! + raw[2]!, 16),
    ];
  }
  return [
    Number.parseInt(raw.slice(0, 2), 16),
    Number.parseInt(raw.slice(2, 4), 16),
    Number.parseInt(raw.slice(4, 6), 16),
  ];
}

function hexOf(rgb: Rgb): string {
  return `#${rgb.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

function pickColor(source: Record<string, unknown>, names: string[], fallback: string): string {
  for (const name of names) {
    const value = source[name];
    if (parseHex(value)) return String(value).trim();
  }
  return fallback;
}

/**
 * Discovery currently ships `design.theme` (`{ light, dark }`) under
 * `branding.colors`. A flat `{ accent, surface }` map is also accepted so a
 * fixture does not have to reconstruct the whole token tree.
 */
export function paletteFrom(colors: unknown): Branding["colors"] {
  const record = colors && typeof colors === "object" ? (colors as Record<string, unknown>) : {};
  const nested = record.light && typeof record.light === "object"
    ? (record.light as Record<string, unknown>)
    : record;
  return {
    surface: pickColor(nested, ["surface", "paper", "background", "bg"], NEUTRAL.surface),
    ink: pickColor(nested, ["ink", "foreground", "text"], NEUTRAL.ink),
    accent: pickColor(nested, ["accent", "primary", "brand"], NEUTRAL.accent),
    onAccent: pickColor(nested, ["onAccent", "on-accent"], NEUTRAL.onAccent),
  };
}

export function brandingFrom(url: string, document: Record<string, unknown>): Branding {
  const branding = (document.branding ?? {}) as Record<string, unknown>;
  const colors = paletteFrom(branding.colors);
  const rgb = {
    surface: parseHex(colors.surface) ?? parseHex(NEUTRAL.surface)!,
    ink: parseHex(colors.ink) ?? parseHex(NEUTRAL.ink)!,
    accent: parseHex(colors.accent) ?? parseHex(NEUTRAL.accent)!,
    onAccent: parseHex(colors.onAccent) ?? parseHex(NEUTRAL.onAccent)!,
  };
  return {
    url,
    name: typeof document.name === "string" && document.name.trim() ? document.name.trim() : url,
    tagline: typeof document.tagline === "string" && document.tagline.trim() ? document.tagline.trim() : null,
    colors: {
      surface: hexOf(rgb.surface),
      ink: hexOf(rgb.ink),
      accent: hexOf(rgb.accent),
      onAccent: hexOf(rgb.onAccent),
    },
    rgb,
    logoUrl: typeof branding.logoUrl === "string" && branding.logoUrl ? branding.logoUrl : null,
    locales: (document.locales as Branding["locales"]) ?? { default: "en", enabled: ["en"] },
    country: typeof document.country === "string" ? document.country : "US",
  };
}

export function storeCopy(brand: Branding): {
  name: string;
  subtitle: string;
  description: string;
  keywords: string;
  shortDescription: string;
} {
  const name = brand.name.slice(0, 30);
  const subtitle = (brand.tagline ?? "Client app").slice(0, 30);
  const shortDescription = (brand.tagline ?? `${brand.name} customer app`).slice(0, 80);
  const description = [
    `${brand.name} is the customer app for this business.`,
    brand.tagline ? brand.tagline : null,
    "Book, view galleries, and pay invoices from your phone — the same records as the website, never a second copy.",
  ]
    .filter(Boolean)
    .join("\n\n");
  return {
    name,
    subtitle,
    description,
    keywords: "booking,gallery,invoice,client",
    shortDescription,
  };
}
