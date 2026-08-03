// Copyright (C) 2026 Camp Denman Society
// SPDX-License-Identifier: AGPL-3.0-only
// The single Zod env schema (MASTER.md §14, §17). Every environment variable
// the platform reads is declared here — nothing reads process.env directly.
// Validation is lazy so `next build` succeeds without a database attached;
// anything that *uses* env at runtime gets a plain-English failure instead.
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  /** Postgres connection string. Required at runtime, not at build time. */
  DATABASE_URL: z.string().url().optional(),
  /**
   * Throwaway database for the test suite. Declared here because this file is
   * the single register of what the platform reads — vitest.config.ts maps it
   * onto DATABASE_URL so tests can never reach the development database.
   */
  TEST_DATABASE_URL: z.string().url().optional(),
  /** Absolute base URL of this instance, e.g. https://example.com */
  APP_URL: z.string().url().default("http://localhost:3000"),
  /** 32+ char secret for session-token hashing. Required in production. */
  SESSION_SECRET: z.string().min(32).optional(),

  /**
   * S3-compatible object storage (§12). One set of names for DigitalOcean
   * Spaces, Cloudflare R2, MinIO, Backblaze and AWS alike — they speak the
   * same protocol, so naming them after a vendor would be a lie the next
   * migration has to unpick. Required only when storage is set to "s3".
   */
  S3_ENDPOINT: z.string().url().optional(),
  S3_REGION: z.string().optional(),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  /** Serve from a CDN or custom domain instead of the bucket host. */
  S3_PUBLIC_BASE_URL: z.string().url().optional(),
  /** "true" only if the bucket really is world-readable. Default: private. */
  S3_PUBLIC: z.enum(["true", "false"]).optional(),

  /** Replit Object Storage (§20). Discovered from the environment on Replit. */
  REPLIT_BUCKET_ID: z.string().optional(),

  /** Development only — production mandates managed object storage (§18). */
  LOCAL_STORAGE_ROOT: z.string().optional(),

  /**
   * Overrides `adapters.storage` from freeholder.config.ts.
   *
   * §17 describes that file as the instance, checked in — which holds when an
   * owner forks and builds their own image. It cannot hold for the *published*
   * image, because one artifact serves every instance and cannot carry any of
   * their choices. So the declarative config remains the default and the
   * environment overrides it, which is the only arrangement where a shared
   * image and a per-instance configuration can both be true.
   */
  FREEHOLDER_STORAGE: z.enum(["s3", "replit", "local"]).optional(),

  /**
   * Permits local-disk storage in production, against §18's mandate.
   *
   * Declared here rather than read where it is used, because a guard that
   * decides what "production" means from a different source than the rest of
   * the platform can disagree with it — and this particular disagreement ends
   * with an owner's uploads on a disk that a rebuild throws away.
   */
  FREEHOLDER_UNSAFE_LOCAL_STORAGE: z.enum(["1"]).optional(),

  /**
   * Install the Aurora Coast demo business at boot, if the site is empty.
   *
   * For demo deploys, the plugin dev harness (§25) and the SEO gate (§15.2),
   * which needs a site to crawl inside a container it did not build. Read once
   * at startup and never in response to a request — a route that installs a
   * demo business is a route somebody eventually hits on a real instance.
   */
  FREEHOLDER_SEED_DEMO: z.enum(["1"]).optional(),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

export function env(): Env {
  if (!cached) {
    const parsed = envSchema.safeParse(process.env);
    if (!parsed.success) {
      const details = parsed.error.issues
        .map((i) => `  ${i.path.join(".")}: ${i.message}`)
        .join("\n");
      throw new Error(`Invalid environment:\n${details}\nSee .env.example.`);
    }
    cached = parsed.data;
  }
  return cached;
}

/** Tests only: forget the cached parse so a suite can vary the environment. */
export function resetEnvForTests(): void {
  cached = undefined;
}

/**
 * Everything a production instance must have before it serves a request.
 *
 * Deliberately *not* a `.refine()` on the schema: `next build` runs with
 * NODE_ENV=production and no secrets attached, so making the schema itself
 * strict would break the build. This runs at boot instead, which is the first
 * moment the distinction between building and running actually exists — and
 * it reports everything missing at once rather than one failure per attempt.
 */
export function requireProductionEnv(): void {
  const current = env();
  if (current.NODE_ENV !== "production") return;

  const missing: string[] = [];
  if (!current.DATABASE_URL) {
    missing.push("DATABASE_URL — the Postgres 15+ connection string");
  }
  if (!current.SESSION_SECRET) {
    missing.push(
      'SESSION_SECRET — 32+ random characters; generate one with:\n      node -e "console.log(crypto.randomBytes(32).toString(\'hex\'))"',
    );
  }
  if (missing.length > 0) {
    throw new Error(
      `This instance cannot start in production. Missing:\n${missing
        .map((m) => `  - ${m}`)
        .join("\n")}\nSee .env.example.`,
    );
  }
}

/** Fails loudly, in plain English, when the database is needed but absent. */
export function databaseUrl(): string {
  const url = env().DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env and point it at a Postgres 15+ database.",
    );
  }
  return url;
}
