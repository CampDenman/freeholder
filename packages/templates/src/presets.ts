// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Business presets for @freeholder/templates (C3.15).
export const BENCH_TOKENS = {
  paper: "#f4f1ea",
  ink: "#1c1b19",
  accent: "#2458d0",
  radius: "md",
  measure: "wide",
} as const;

export const PRESETS = {
  creator: {
    name: "Creator",
    tokens: { ...BENCH_TOKENS, measure: "narrow" as const },
    pages: [
      { slug: "home", title: "Home", blocks: ["heading", "rich", "image"] },
      { slug: "about", title: "About", blocks: ["heading", "rich"] },
      { slug: "contact", title: "Contact", blocks: ["heading", "form"] },
    ],
    entities: [{ type: "product", template: "product-page" }],
    emails: [{ key: "welcome", slots: ["name", "siteName"] }],
    seed: { pages: 3, contacts: 0 },
  },
  "service-business": {
    name: "Service business",
    tokens: { ...BENCH_TOKENS, radius: "sm" as const },
    pages: [
      { slug: "home", title: "Home", blocks: ["heading", "rich"] },
      { slug: "services", title: "Services", blocks: ["heading", "rich"] },
      { slug: "about", title: "About", blocks: ["heading", "rich"] },
      { slug: "contact", title: "Contact", blocks: ["heading", "form"] },
    ],
    entities: [{ type: "offering", template: "service-page" }],
    emails: [{ key: "booking-confirm", slots: ["name", "startsAt"] }],
    seed: { pages: 4, contacts: 0 },
  },
  shop: {
    name: "Shop",
    tokens: { ...BENCH_TOKENS },
    pages: [
      { slug: "home", title: "Home", blocks: ["heading", "rich", "image"] },
      { slug: "products", title: "Products", blocks: ["heading"] },
      { slug: "about", title: "About", blocks: ["heading", "rich"] },
      { slug: "contact", title: "Contact", blocks: ["heading", "form"] },
    ],
    entities: [{ type: "product", template: "product-page" }],
    emails: [{ key: "order-receipt", slots: ["name", "total"] }],
    seed: { pages: 4, contacts: 0 },
  },
} as const;

export type PresetKey = keyof typeof PRESETS;

export function preset(key: PresetKey) {
  return PRESETS[key];
}

export function listPresets(): PresetKey[] {
  return Object.keys(PRESETS) as PresetKey[];
}
