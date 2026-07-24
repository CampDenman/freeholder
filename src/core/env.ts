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
  /** Absolute base URL of this instance, e.g. https://example.com */
  APP_URL: z.string().url().default("http://localhost:3000"),
  /** 32+ char secret for session-token hashing. Required in production. */
  SESSION_SECRET: z.string().min(32).optional(),
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
