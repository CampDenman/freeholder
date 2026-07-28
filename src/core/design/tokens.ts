// Copyright (C) 2026 Camp Denman Society
// SPDX-License-Identifier: AGPL-3.0-only
// The design tokens (MASTER.md §32: "design tokens, not themes").
//
// This file is the single source of truth for the platform's look, and it is
// deliberately plain data — no CSS, no React, no framework. That is what lets
// three very different consumers share one design:
//
//   • the web app, which emits these as CSS custom properties per request
//   • the React Native app (§35), which reads the same object at runtime
//   • packages/templates, whose themes are overrides of these values
//
// Tokens are *semantic*, not literal: components ask for `surface` or `accent`,
// never for a hex code. Rebranding is then a remapping rather than an edit to
// every component, which is what makes an owner's brand a settings save (§32)
// and what keeps the platform's chrome from fighting the business it hosts.
//
// The default set is "Bench": a working surface for a one-person business —
// cool paper, graphite ink, one saturated cobalt that means "this is the
// action", and monospaced labels for the things you read as data.

export interface ColorTokens {
  /** Page ground. */
  paper: string;
  /** Cards, panels, anything lifted off the page. */
  surface: string;
  /** Rails, headers, footers — a step away from `surface`. */
  surfaceMuted: string;
  /** Input interiors. Distinct from `surface` so fields read as editable. */
  field: string;
  /** Body text and headings. */
  ink: string;
  /** Secondary text, labels, captions. */
  inkMuted: string;
  /** Hairlines and borders. */
  rule: string;
  /** The one colour that means "act". Used sparingly, on purpose. */
  accent: string;
  /** Text and icons placed on `accent`. */
  onAccent: string;
  /** Accent at low emphasis: selected rows, quiet highlights. */
  accentSoft: string;
  /** Semantic states — deliberately separate from the accent hue. */
  success: string;
  successSoft: string;
  warning: string;
  warningSoft: string;
  danger: string;
  dangerSoft: string;
  /** Keyboard focus. Must clear 3:1 against both paper and surface. */
  focus: string;
}

export interface ThemeTokens {
  light: ColorTokens;
  dark: ColorTokens;
}

/**
 * Cool paper rather than cream, and a neutral carrying a faint blue bias
 * toward the accent — a pure grey next to a saturated blue reads as an
 * oversight rather than a choice.
 */
export const colors: ThemeTokens = {
  light: {
    paper: "#fafaf8",
    surface: "#ffffff",
    surfaceMuted: "#f4f4f1",
    field: "#ffffff",
    ink: "#23262a",
    inkMuted: "#6b7076",
    rule: "#e3e3de",
    accent: "#2551e0",
    onAccent: "#ffffff",
    accentSoft: "#e6ecfd",
    // Darker than it first looked right: the original #1a7f52 read at 4.32:1
    // on its own soft ground, which fails AA. Contrast decided this, not taste.
    success: "#17734a",
    successSoft: "#e3f2ea",
    warning: "#8c5b0e",
    warningSoft: "#fbeed6",
    danger: "#b3261e",
    dangerSoft: "#fbe6e4",
    focus: "#2551e0",
  },
  dark: {
    paper: "#121316",
    surface: "#191b1f",
    surfaceMuted: "#1f2126",
    field: "#141619",
    ink: "#eceef0",
    inkMuted: "#9aa0a8",
    rule: "#2b2e34",
    // Lifted and desaturated: the light-mode cobalt is unreadable on a dark
    // ground, and a theme that merely inverts is how contrast gets lost.
    accent: "#5c86ff",
    onAccent: "#0d1016",
    accentSoft: "#1a2440",
    success: "#4fb488",
    successSoft: "#14291f",
    warning: "#e0ae55",
    warningSoft: "#2c2312",
    danger: "#f08d85",
    dangerSoft: "#2e1917",
    focus: "#5c86ff",
  },
};

/** A 1.2 (minor third) scale from 13px, which keeps dense admin screens calm. */
export const fontSize = {
  xs: "0.6875rem", // 11px — mono labels, metadata
  sm: "0.8125rem", // 13px — secondary text, table cells
  base: "0.875rem", // 14px — interface default
  md: "1rem", // 16px — body copy on public pages
  lg: "1.25rem", // 20px — card and section titles
  xl: "1.5rem", // 24px — page titles
  "2xl": "2rem", // 32px — public headings
  "3xl": "2.75rem", // 44px — hero
} as const;

export const fontFamily = {
  /** Schibsted Grotesk: warm grotesque, open apertures, legible small. */
  sans: '"Schibsted Grotesk", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  /** JetBrains Mono: field labels, IDs, currency — anywhere digits align. */
  mono: '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
} as const;

/**
 * 4px base. Every gap in the interface is a multiple, so spacing is a decision
 * from a set rather than a number somebody typed.
 */
export const space = {
  "0.5": "0.125rem",
  "1": "0.25rem",
  "2": "0.5rem",
  "3": "0.75rem",
  "4": "1rem",
  "5": "1.25rem",
  "6": "1.5rem",
  "8": "2rem",
  "10": "2.5rem",
  "12": "3rem",
  "16": "4rem",
} as const;

/** Soft, not pill: 8px reads as built rather than decorative. */
export const radius = {
  sm: "0.25rem",
  base: "0.375rem",
  md: "0.5rem",
  lg: "0.75rem",
  full: "9999px",
} as const;

/**
 * Restrained on purpose. Depth in this interface comes from the rule colour
 * and surface steps; heavy shadows would make an admin screen feel like a
 * consumer app and would not survive a dark theme intact.
 */
export const shadow = {
  none: "none",
  sm: "0 1px 2px rgb(16 18 22 / 0.06)",
  md: "0 2px 8px rgb(16 18 22 / 0.08)",
} as const;

export const motion = {
  fast: "120ms",
  base: "180ms",
  easing: "cubic-bezier(0.2, 0, 0.2, 1)",
} as const;

export const tokens = {
  colors,
  fontSize,
  fontFamily,
  space,
  radius,
  shadow,
  motion,
} as const;

export type Tokens = typeof tokens;

const CSS_VAR_PREFIX = "fh";

function toKebab(key: string): string {
  return key.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}

/**
 * Colour tokens as CSS custom-property declarations.
 *
 * §32 requires these to be emitted at request time, because an owner's brand
 * lives in settings rows rather than in a stylesheet — so a rebrand takes
 * effect on the next page load and never needs a build.
 */
export function colorsToCss(scheme: ColorTokens): string {
  return Object.entries(scheme)
    .map(([key, value]) => `--${CSS_VAR_PREFIX}-${toKebab(key)}: ${value};`)
    .join("\n  ");
}

/** The `<style>` body that themes a document, both schemes included. */
export function themeStylesheet(theme: ThemeTokens = colors): string {
  return [
    `:root {\n  ${colorsToCss(theme.light)}\n}`,
    `@media (prefers-color-scheme: dark) {\n  :root {\n    ${colorsToCss(theme.dark)}\n  }\n}`,
    `:root[data-theme="dark"] {\n  ${colorsToCss(theme.dark)}\n}`,
    `:root[data-theme="light"] {\n  ${colorsToCss(theme.light)}\n}`,
  ].join("\n");
}
