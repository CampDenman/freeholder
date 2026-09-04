// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// One reviewed runtime identity across local setup, CI, packages and images.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function manifest(path: string): {
  engines?: { node?: string };
} {
  return JSON.parse(readFileSync(path, "utf8")) as {
    engines?: { node?: string };
  };
}

describe("runtime version integrity", () => {
  it("pins CI and every container stage to the reviewed Node release", () => {
    const version = readFileSync(".node-version", "utf8").trim();
    expect(version).toMatch(/^\d+\.\d+\.\d+$/);

    const setup = readFileSync(".github/actions/setup-project/action.yml", "utf8");
    expect(setup).toContain("node-version-file: .node-version");

    const dockerfile = readFileSync("Dockerfile", "utf8");
    const baseImages = [
      ...dockerfile.matchAll(/^FROM node:(\S+) AS (?:deps|build|runtime)$/gm),
    ];
    expect(baseImages).toHaveLength(3);
    for (const [, image] of baseImages) {
      expect(image).toMatch(
        new RegExp(`^${version}-bookworm-slim@sha256:[a-f0-9]{64}$`),
      );
    }
  });

  it("keeps every distributable package on the platform Node support floor", () => {
    const expected = manifest("package.json").engines?.node;
    expect(expected).toBeTruthy();
    for (const name of ["create-freeholder", "plugin-kit", "sdk", "templates"]) {
      expect(manifest(`packages/${name}/package.json`).engines?.node).toBe(expected);
    }
  });
});
