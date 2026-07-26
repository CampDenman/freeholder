// Copyright (C) 2026 Camp Denman Society
// SPDX-License-Identifier: AGPL-3.0-only
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  // Schema is owned per-module (MASTER.md §11) and by core.
  schema: ["./src/core/**/schema.ts", "./src/modules/**/schema.ts"],
  out: "./db/migrations",
  dbCredentials: {
    url:
      process.env.DATABASE_URL ??
      "postgres://postgres:postgres@localhost:5432/freeholder_dev",
  },
});
