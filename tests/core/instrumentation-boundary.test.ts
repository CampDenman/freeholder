// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The shared Next instrumentation entrypoint must stay safe to bundle for Edge.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("instrumentation runtime boundary", () => {
  it("keeps Node dependencies behind Next's runtime dispatch", () => {
    const entrypoint = readFileSync("instrumentation.ts", "utf8");

    expect(entrypoint).toContain('process.env.NEXT_RUNTIME !== "nodejs"');
    expect(entrypoint).toContain('import("./instrumentation.node")');
    expect(entrypoint).not.toMatch(/from ["'](?:node:|@\/|\.\/src\/)/);
    expect(entrypoint).not.toMatch(/import\(["'](?:node:|@\/|\.\/src\/)/);
  });
});
