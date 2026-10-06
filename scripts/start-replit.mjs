// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Read prepared local configuration without replacing Replit's injected Secrets.
try { process.loadEnvFile(".env"); } catch (error) { if (error.code !== "ENOENT") throw error; }
if (!process.env.DATABASE_URL || !process.env.BOOTSTRAP_SECRET || !process.env.SESSION_SECRET || !process.env.CREDENTIAL_KEY) {
  console.error("Replit setup is incomplete. Ask Agent to provision PostgreSQL and Object Storage, run pnpm launch:prepare --target replit --url YOUR_HTTPS_URL, and import the private .env into Secrets. No credentials should be pasted into chat.");
  process.exit(2);
}
if (process.env.FREEHOLDER_STORAGE !== "replit" || !process.env.REPLIT_BUCKET_ID) {
  console.error("Use private Replit Object Storage: configure FREEHOLDER_STORAGE=replit and REPLIT_BUCKET_ID before starting.");
  process.exit(2);
}
// Runtime instrumentation migrates exactly once before initializing services/jobs.
process.env.NEXT_MANUAL_SIG_HANDLE = "true";
process.argv.splice(2, 0, "dev");
await import("next/dist/bin/next");
