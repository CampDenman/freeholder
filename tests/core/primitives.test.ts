// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Segmented checked-on-accent pairing (C11.12). has-[:checked] only matches a
// descendant control, so muted ink on a sibling span paints ~1.26:1 on accent.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const primitives = readFileSync("src/ui/primitives.tsx", "utf8");

function extract(name: string): string {
  const start = primitives.indexOf(`export function ${name}`);
  expect(start, name).toBeGreaterThan(-1);
  const next = primitives.indexOf("export function", start + 1);
  return primitives.slice(start, next === -1 ? undefined : next);
}

describe("Segmented (C11.12)", () => {
  const source = extract("Segmented");

  it("puts muted and on-accent colour on the label that owns the radio", () => {
    expect(source).toMatch(/<label[\s\S]*text-ink-muted[\s\S]*has-\[:checked\]:bg-accent/);
    expect(source).toMatch(/<label[\s\S]*has-\[:checked\]:text-on-accent/);
    expect(source).toContain('type="radio"');
  });

  it("does not put text-ink-muted on a child with a doomed has-[:checked]", () => {
    const span = source.match(/<span className="([^"]*)"/);
    expect(span?.[1]).toBe("block px-4 py-2");
    expect(source).not.toMatch(
      /<(?!label\b)[a-z]+[^>]*text-ink-muted[^>]*has-\[:checked\]/,
    );
  });
});
