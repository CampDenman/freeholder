// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { definePlugin } from "@freeholder/plugin-kit";

export default definePlugin({
  name: "print-on-demand",
  version: "0.1.0",
  freeholder: ">=0.0.0",
  license: "Apache-2.0",
  permissions: ["catalog:write"],
  requires: ["core"],
  migrations: ["0075_first_party_plugins.sql"],
  capabilities: { adapters: ["storage"] },
  tables: () => import("./tables"),
  services: () => import("./service"),
});
