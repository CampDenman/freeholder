// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  // Schema is owned per-module (MASTER.md §11) and by core. `*-schema.ts`
  // holds tables that outgrew a single file (imports, audiences, broadcasts).
  // First-party plugin tables are in the chain through 0163; sibling 0168_*
  // migrations are not on this branch and must be folded in when they land.
  schema: [
    "./src/core/**/schema.ts",
    "./src/core/**/*-schema.ts",
    "./src/modules/**/schema.ts",
    "./src/modules/**/*-schema.ts",
    "./plugins/**/schema.ts",
  ],
  out: "./db/migrations",
  dbCredentials: {
    url:
      process.env.DATABASE_URL ??
      "postgres://postgres:postgres@localhost:5432/freeholder_dev",
  },
});
