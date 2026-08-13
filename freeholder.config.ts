// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// This instance, declaratively (MASTER.md §17). No secrets here — see .env.
import { defineConfig } from "@/core/config";

export default defineConfig({
  target: "local",
  preset: "everything",
  locales: ["en"],
  baseCurrency: "USD",
});
