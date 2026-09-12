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
  migrations: [
    "0075_first_party_plugins.sql",
    "0163_first_party_plugin_surfaces.sql",
    "0168_community_rooms.sql",
  ],
  capabilities: { widgets: true },
  events: {
    emits: ["community.joined", "community.posted"],
  },
  tables: () => import("./tables"),
  services: () => import("./service"),
});
