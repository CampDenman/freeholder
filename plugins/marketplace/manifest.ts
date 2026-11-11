// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { definePlugin } from "@freeholder/plugin-kit";

export default definePlugin({
  name: "marketplace",
  version: "0.1.0",
  freeholder: "^0.2.0",
  license: "Apache-2.0",
  permissions: ["contacts:write", "invoicing:write", "catalog:write", "network:external"],
  requires: ["core", "invoicing"],
  migrations: ["0000_reviewed-baseline.sql", "0004_marketplace_channel_sync.sql", "0012_owner_storage_refunds.sql"],
  capabilities: { adapters: ["payments"] },
  events: {
    emits: ["marketplace.channelAdded", "marketplace.orderImported", "marketplace.refundReconciled"],
  },
  tables: () => import("./tables"),
  services: () => import("./service"),
  jobs: () => import("./jobs"),
});
