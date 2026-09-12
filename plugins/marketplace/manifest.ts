// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { definePlugin } from "@freeholder/plugin-kit";

export default definePlugin({
  name: "marketplace",
  version: "0.1.0",
  freeholder: ">=0.0.0",
  license: "Apache-2.0",
  permissions: ["catalog:write", "network:external"],
  requires: ["core", "invoicing"],
  migrations: ["0000_reviewed-baseline.sql", "0004_marketplace_channel_sync.sql"],
  capabilities: { adapters: ["payments"] },
  events: {
    emits: ["marketplace.channelAdded", "marketplace.orderImported"],
  },
  tables: () => import("./tables"),
  services: () => import("./service"),
  jobs: () => import("./jobs"),
});
