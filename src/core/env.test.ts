// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { databaseUrl, env } from "@/core/env";

describe("env", () => {
  it("parses with defaults and no database attached", () => {
    const e = env();
    expect(e.APP_URL).toMatch(/^https?:\/\//);
  });

  it("fails in plain English when the database is needed but absent", () => {
    if (!env().DATABASE_URL) {
      expect(() => databaseUrl()).toThrow(/DATABASE_URL is not set/);
    } else {
      expect(databaseUrl()).toContain("postgres");
    }
  });
});
