// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { definePlugin } from "@freeholder/plugin-kit";

export default definePlugin({
  name: "gift-registry",
  version: "0.1.0",
  freeholder: ">=0.0.0",
  license: "Apache-2.0",
  permissions: ["contacts:read", "invoicing:create"],
  requires: ["core", "invoicing"],
  migrations: ["0000_reviewed-baseline.sql"],
  capabilities: { blocks: false },
  tables: () => import("./tables"),
  services: () => import("./service"),
});
