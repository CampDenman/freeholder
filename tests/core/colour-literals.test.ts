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
import { NEUTRAL as STORE_ASSET_FALLBACK } from "../../packages/freeholder-app/src/branding";

const ROOT = process.cwd();
const COLOR_LITERAL =
  /(?:#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(|oklch\()/;
// Tailwind's raw palette, the other shape the root ESLint colour gate refuses.
const RAW_PALETTE =
  /(^|[\s'"`])(bg|text|border|ring|outline|fill|stroke|from|via|to|divide|decoration|caret|accent)-(white|black|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)([-0-9/]|$|[\s'"`])/m;

// packages/** is outside the root ESLint program (each package has its own
// build), so this scan is its colour gate. A package may hold literals only in
// a palette file whose every value is pinned to the platform tokens below.
const PINNED_PACKAGE_PALETTES = new Set([
  "packages/mobile-app/src/branding.ts",
  "packages/templates/src/presets.ts",
  "packages/freeholder-app/src/branding.ts",
]);

function packageColourHits(file: string, source: string): string[] {
  const body = withoutComments(source);
  const hits: string[] = [];
  if (COLOR_LITERAL.test(body)) hits.push(`${file}: colour literal`);
  if (RAW_PALETTE.test(body)) hits.push(`${file}: raw Tailwind palette class`);
  return hits;
}

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

describe("package UI colour literals (C11.10)", () => {
  it("recognises literal, SVG attribute and raw palette bypasses", () => {
    expect(packageColourHits("x.tsx", `<path fill="#16181d" />`)).toHaveLength(1);
    expect(packageColourHits("x.ts", "const svg = `<rect stroke='rgb(0 0 0)'/>`;")).toHaveLength(1);
    expect(packageColourHits("x.tsx", `<div className="bg-white p-4" />`)).toHaveLength(1);
    expect(packageColourHits("x.tsx", `// #fff in a comment\n<div className="bg-surface" />`)).toEqual([]);
  });

  it("keeps package sources on tokens outside pinned palette files", () => {
    const files = readdirSync(join(ROOT, "packages"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .flatMap((entry) => {
        const src = join(ROOT, "packages", entry.name, "src");
        try {
          return [".ts", ".tsx", ".css", ".mjs", ".svg"].flatMap((suffix) => walk(src, suffix));
        } catch {
          return [];
        }
      })
      .map((file) => file.slice(ROOT.length + 1).replaceAll("\\", "/"))
      // Generated SDK types carry no UI.
      .filter((file) => !file.endsWith("/generated.ts") && !file.endsWith(".d.ts"));
    expect(files.length).toBeGreaterThan(0);
    const hits = files
      .filter((file) => !PINNED_PACKAGE_PALETTES.has(file))
      .flatMap((file) => packageColourHits(file, readFileSync(join(ROOT, file), "utf8")));
    expect(hits, hits.join("\n")).toEqual([]);
  });
});

describe("package palettes (C11.15)", () => {
  it("keeps the store-asset fallback on the platform light tokens", () => {
    expect(STORE_ASSET_FALLBACK.surface).toBe(colors.light.surface);
    expect(STORE_ASSET_FALLBACK.ink).toBe(colors.light.ink);
    expect(STORE_ASSET_FALLBACK.accent).toBe(colors.light.accent);
    expect(STORE_ASSET_FALLBACK.onAccent).toBe(colors.light.onAccent);
    expect(contrastRatio(STORE_ASSET_FALLBACK.ink, STORE_ASSET_FALLBACK.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(STORE_ASSET_FALLBACK.onAccent, STORE_ASSET_FALLBACK.accent)).toBeGreaterThanOrEqual(4.5);
  });

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
