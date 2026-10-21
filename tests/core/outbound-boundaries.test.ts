// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Every URL sourced from an owner or provider payload must reach the network
// through an address-pinned transport, not bare fetch().
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("externally supplied outbound URL boundaries", () => {
  it.each([
    ["social media", "src/adapters/social/media.ts"],
    ["calendar feeds", "src/core/scheduling/ics-service.ts"],
    ["remote catalogues", "src/core/catalogue/service.ts"],
  ])("pins and bounds %s downloads", (_label, path) => {
    const contents = source(path);
    expect(contents).toContain("getPinnedBytes(");
    expect(contents).not.toMatch(/globalThis\.fetch\s*\(/);
  });

  it("pins contribution hub and reply delivery", () => {
    const contents = source("src/core/contribute/deliver.ts");
    expect(contents).toContain("return postWebhook(url, body, headers");
    expect(contents).toContain("allowLocal: false");
  });
});
