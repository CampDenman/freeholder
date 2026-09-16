// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, it } from "vitest";
import {
  databaseUrl,
  env,
  requireProductionEnv,
  resetEnvForTests,
} from "@/core/env";

/** Run a body against a temporary environment, always restoring it after. */
function withEnv(overrides: Record<string, string | undefined>, body: () => void) {
  const previous = { ...process.env };
  Object.assign(process.env, overrides);
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[key];
  }
  resetEnvForTests();
  try {
    body();
  } finally {
    process.env = previous;
    resetEnvForTests();
  }
}

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

  it("declares TEST_DATABASE_URL, so nothing reads it off process.env raw", () => {
    withEnv(
      { TEST_DATABASE_URL: "postgres://localhost:5432/freeholder_test" },
      () => {
        expect(env().TEST_DATABASE_URL).toContain("freeholder_test");
      },
    );
  });

  it("treats blank optional placeholders from a copied .env.example as unset", () => {
    withEnv(
      {
        SESSION_SECRET: "",
        S3_ENDPOINT: "",
        MAIL_ADAPTER: "",
        FREEHOLDER_SEED_DEMO: "",
      },
      () => {
        const parsed = env();
        expect(parsed.SESSION_SECRET).toBeUndefined();
        expect(parsed.S3_ENDPOINT).toBeUndefined();
        expect(parsed.MAIL_ADAPTER).toBeUndefined();
        expect(parsed.FREEHOLDER_SEED_DEMO).toBeUndefined();
      },
    );
  });
});

describe("requireProductionEnv()", () => {
  afterEach(resetEnvForTests);

  it("says nothing outside production", () => {
    withEnv({ NODE_ENV: "development", SESSION_SECRET: undefined }, () => {
      expect(() => requireProductionEnv()).not.toThrow();
    });
  });

  it("refuses to start without a session secret", () => {
    // The bug this replaces: production started fine and failed on the first
    // login attempt instead, hours later, as a 500.
    withEnv(
      {
        NODE_ENV: "production",
        DATABASE_URL: "postgres://localhost:5432/live",
        SESSION_SECRET: undefined,
      },
      () => {
        expect(() => requireProductionEnv()).toThrow(/SESSION_SECRET/);
      },
    );
  });

  it("reports everything missing at once", () => {
    withEnv(
      {
        NODE_ENV: "production",
        DATABASE_URL: undefined,
        SESSION_SECRET: undefined,
      },
      () => {
        const error = (() => {
          try {
            requireProductionEnv();
          } catch (e) {
            return e as Error;
          }
          throw new Error("expected requireProductionEnv to throw");
        })();
        expect(error.message).toContain("DATABASE_URL");
        expect(error.message).toContain("SESSION_SECRET");
      },
    );
  });

  it("is satisfied by a complete production environment", () => {
    withEnv(
      {
        NODE_ENV: "production",
        DATABASE_URL: "postgres://localhost:5432/live",
        SESSION_SECRET: "x".repeat(32),
      },
      () => {
        expect(() => requireProductionEnv()).not.toThrow();
      },
    );
  });
});
