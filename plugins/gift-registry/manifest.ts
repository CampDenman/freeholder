// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { definePlugin } from "@freeholder/plugin-kit";

export default definePlugin({
  name: "gift-registry",
  version: "0.1.0",
  freeholder: ">=0.0.0",
  license: "Apache-2.0",
  permissions: ["contacts:read", "invoicing:create"],
  requires: ["core"],
  migrations: ["0075_first_party_plugins.sql"],
  capabilities: { blocks: false },
  tables: () => import("./tables"),
  services: () => import("./service"),
});
