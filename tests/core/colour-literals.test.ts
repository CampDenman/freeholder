// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C11.15 colour holes the Tailwind ESLint rule cannot see: .css files,
// packages outside the root ESLint program, and palettes with no contrast test.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { colors, contrastRatio } from "@/core/design/tokens";
import {
  FALLBACK_COLORS,
  FALLBACK_COLORS_DARK,
} from "../../packages/mobile-app/src/branding";
import { BENCH_TOKENS } from "../../packages/templates/src/presets";

const ROOT = process.cwd();
const COLOR_LITERAL =
  /(?:#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(|oklch\()/;

function walk(dir: string, suffix: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const child = join(dir, entry.name);
    if (entry.isDirectory()) walk(child, suffix, found);
    else if (entry.name.endsWith(suffix)) found.push(child);
  }
  return found;
}

function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

describe("CSS colour literals (C11.15)", () => {
  it("keeps stylesheets on token variables rather than rgb/hex fallbacks", () => {
    const files = walk(join(ROOT, "app"), ".css");
    expect(files.length).toBeGreaterThan(0);
    const hits: string[] = [];
    for (const file of files) {
      const body = withoutComments(readFileSync(file, "utf8"));
      if (COLOR_LITERAL.test(body)) hits.push(file);
    }
    expect(hits, hits.join(", ")).toEqual([]);
  });
});

describe("package palettes (C11.15)", () => {
  it("keeps the template bench override on the platform light tokens", () => {
    expect(BENCH_TOKENS.paper).toBe(colors.light.paper);
    expect(BENCH_TOKENS.ink).toBe(colors.light.ink);
    expect(BENCH_TOKENS.accent).toBe(colors.light.accent);
    expect(contrastRatio(BENCH_TOKENS.ink, BENCH_TOKENS.paper)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(colors.light.onAccent, BENCH_TOKENS.accent)).toBeGreaterThanOrEqual(4.5);
  });

  it("gives the mobile unbranded fallback AA contrast in both schemes", () => {
    expect(FALLBACK_COLORS.surface).toBe(colors.light.surface);
    expect(FALLBACK_COLORS.ink).toBe(colors.light.ink);
    expect(FALLBACK_COLORS.accent).toBe(colors.light.accent);
    expect(FALLBACK_COLORS_DARK.surface).toBe(colors.dark.surface);
    expect(FALLBACK_COLORS_DARK.ink).toBe(colors.dark.ink);
    expect(FALLBACK_COLORS_DARK.accent).toBe(colors.dark.accent);

    for (const [scheme, palette] of [
      ["light", FALLBACK_COLORS],
      ["dark", FALLBACK_COLORS_DARK],
    ] as const) {
      expect(contrastRatio(palette.ink, palette.surface), `${scheme} ink`).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(palette.inkMuted, palette.surface), `${scheme} muted`).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(palette.onAccent, palette.accent), `${scheme} onAccent`).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(palette.danger, palette.surface), `${scheme} danger`).toBeGreaterThanOrEqual(4.5);
    }
  });
});
