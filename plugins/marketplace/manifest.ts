// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { definePlugin } from "@freeholder/plugin-kit";

export default definePlugin({
  name: "marketplace",
  version: "0.1.0",
  freeholder: ">=0.0.0",
  license: "Apache-2.0",
  permissions: ["catalog:write", "network:external"],
  requires: ["core"],
  migrations: ["0075_first_party_plugins.sql"],
  capabilities: { adapters: ["payments"] },
  tables: () => import("./tables"),
  services: () => import("./service"),
});
