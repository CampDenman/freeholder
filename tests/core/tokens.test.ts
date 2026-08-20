// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The token layer (MASTER.md §32). These are the values the web app, the React
// Native app and packages/templates all read, so the shape is a contract — a
// renamed role is a breaking change for three consumers at once.
import { describe, expect, it } from "vitest";
import {
  colors,
  colorsToCss,
  themeStylesheet,
  tokens,
} from "@/core/design/tokens";

const ROLES = [
  "paper",
  "surface",
  "surfaceMuted",
  "field",
  "ink",
  "inkMuted",
  "rule",
  "accent",
  "onAccent",
  "accentSoft",
  "success",
  "successSoft",
  "warning",
  "warningSoft",
  "danger",
  "dangerSoft",
  "onDanger",
  "focus",
] as const;

/** Relative luminance per WCAG 2, from an #rrggbb string. */
function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

describe("the token set", () => {
  it("defines every role in both schemes", () => {
    for (const scheme of ["light", "dark"] as const) {
      for (const role of ROLES) {
        expect(colors[scheme][role], `${scheme}.${role}`).toMatch(
          /^#[0-9a-f]{6}$/,
        );
      }
    }
  });

  it("does not merely invert — dark has its own accent", () => {
    // A dark theme built by flipping a light one loses contrast exactly where
    // it matters. The cobalt that works on paper is unreadable on graphite.
    expect(colors.dark.accent).not.toBe(colors.light.accent);
    expect(colors.dark.onAccent).not.toBe(colors.light.onAccent);
  });

  describe("contrast", () => {
    for (const scheme of ["light", "dark"] as const) {
      const c = colors[scheme];

      it(`${scheme}: body text clears WCAG AA on every ground`, () => {
        for (const ground of [c.paper, c.surface, c.surfaceMuted, c.field]) {
          expect(contrast(c.ink, ground)).toBeGreaterThanOrEqual(4.5);
        }
      });

      it(`${scheme}: muted text clears AA on paper and surface`, () => {
        expect(contrast(c.inkMuted, c.paper)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(c.inkMuted, c.surface)).toBeGreaterThanOrEqual(4.5);
      });

      it(`${scheme}: text on the accent is legible`, () => {
        expect(contrast(c.onAccent, c.accent)).toBeGreaterThanOrEqual(4.5);
      });

      it(`${scheme}: text on solid danger is legible`, () => {
        // The dark scheme lightens the danger fill, so a literal white
        // would fail here — which is why the pairing is a token at all.
        expect(contrast(c.onDanger, c.danger)).toBeGreaterThanOrEqual(4.5);
      });

      it(`${scheme}: semantic colours read on their own soft grounds`, () => {
        expect(contrast(c.success, c.successSoft)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(c.warning, c.warningSoft)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(c.danger, c.dangerSoft)).toBeGreaterThanOrEqual(4.5);
      });

      it(`${scheme}: focus is visible against the page`, () => {
        // 3:1 is the non-text minimum; a focus ring nobody can see is the
        // same as no focus ring.
        expect(contrast(c.focus, c.paper)).toBeGreaterThanOrEqual(3);
        expect(contrast(c.focus, c.surface)).toBeGreaterThanOrEqual(3);
      });
    }
  });

  it("keeps semantic colour separate from the accent hue", () => {
    // Otherwise "this is the action" and "this went wrong" look alike.
    expect(colors.light.danger).not.toBe(colors.light.accent);
    expect(colors.light.success).not.toBe(colors.light.accent);
  });
});

describe("colorsToCss()", () => {
  it("emits kebab-cased custom properties under one prefix", () => {
    const css = colorsToCss(colors.light);
    expect(css).toContain(`--fh-paper: ${colors.light.paper};`);
    expect(css).toContain(`--fh-surface-muted: ${colors.light.surfaceMuted};`);
    expect(css).toContain(`--fh-on-accent: ${colors.light.onAccent};`);
  });

  it("emits one declaration per role and nothing else", () => {
    const declarations = colorsToCss(colors.dark)
      .split("\n")
      .filter((line) => line.trim().length > 0);
    expect(declarations).toHaveLength(ROLES.length);
  });
});

describe("themeStylesheet()", () => {
  const sheet = themeStylesheet();

  it("covers the system preference and both explicit overrides", () => {
    // The viewer's toggle stamps data-theme on the root, and it has to win in
    // both directions — a page stuck in dark because the OS says so is a bug.
    expect(sheet).toContain("@media (prefers-color-scheme: dark)");
    expect(sheet).toContain(':root[data-theme="dark"]');
    expect(sheet).toContain(':root[data-theme="light"]');
  });

  it("carries no closing tag that could escape the style element", () => {
    // It is injected with dangerouslySetInnerHTML, so this is the check that
    // keeps that honest.
    expect(sheet).not.toMatch(/<\/?script/i);
    expect(sheet).not.toContain("</style>");
  });
});

describe("the scale", () => {
  it("keeps spacing on a 4px grid", () => {
    for (const [name, value] of Object.entries(tokens.space)) {
      const px = parseFloat(value) * 16;
      expect(px % 2, `space.${name} = ${value}`).toBe(0);
    }
  });

  it("names both families with a real fallback chain", () => {
    expect(tokens.fontFamily.sans).toContain("Schibsted Grotesk");
    expect(tokens.fontFamily.sans).toContain("system-ui");
    expect(tokens.fontFamily.mono).toContain("JetBrains Mono");
    expect(tokens.fontFamily.mono).toContain("monospace");
  });
});
