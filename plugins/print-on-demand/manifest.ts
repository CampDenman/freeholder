// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { definePlugin } from "@freeholder/plugin-kit";

export default definePlugin({
  name: "print-on-demand",
  version: "0.1.0",
  freeholder: ">=0.0.0",
  license: "Apache-2.0",
  permissions: ["catalog:write", "contacts:read", "network:external"],
  requires: ["core", "catalog"],
  migrations: ["0000_reviewed-baseline.sql", "0003_print_on_demand_fulfillment.sql", "0008_printify_live_fulfillment.sql"],
  capabilities: { adapters: [] },
  events: {
    emits: ["printOnDemand.queued", "printOnDemand.submitted"],
    listens: { "catalog.orderPaid": "onOrderPaid" },
  },
  tables: () => import("./tables"),
  services: () => import("./service"),
  jobs: () => import("./jobs"),
});
