// SPDX-License-Identifier: AGPL-3.0-only
// This instance, declaratively (MASTER.md §17). No secrets here — see .env.
import { defineConfig } from "@/core/config";

export default defineConfig({
  target: "local",
  preset: "everything",
  locales: ["en"],
  baseCurrency: "USD",
});
