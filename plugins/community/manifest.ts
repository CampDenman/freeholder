// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { definePlugin } from "@freeholder/plugin-kit";

export default definePlugin({
  name: "community",
  version: "0.1.0",
  freeholder: ">=0.0.0",
  license: "Apache-2.0",
  permissions: ["contacts:read"],
  requires: ["core"],
  migrations: ["0000_reviewed-baseline.sql", "0001_community_rooms.sql"],
  capabilities: { widgets: true },
  events: {
    emits: ["community.joined", "community.posted"],
  },
  tables: () => import("./tables"),
  services: () => import("./service"),
});
