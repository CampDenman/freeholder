// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { BENCH_TOKENS, listPresets, preset } from "../../packages/templates/src/presets";

describe("@freeholder/templates (C3.15)", () => {
  it("uses Bench tokens and ships page, entity and email templates", () => {
    expect(BENCH_TOKENS.accent).toMatch(/^#/);
    for (const key of listPresets()) {
      const value = preset(key);
      expect(value.pages.length).toBeGreaterThan(0);
      expect(value.entities.length).toBeGreaterThan(0);
      expect(value.emails.length).toBeGreaterThan(0);
      expect(value.tokens.ink).toBe(BENCH_TOKENS.ink);
    }
  });
});
