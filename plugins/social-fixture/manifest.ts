// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Fixture plugin: a conforming social adapter without core or composer edits
// (MASTER.md §33, C9.31). Tests load it; production module index does not, so
// owners never see a fake network in Admin → Social.
import { definePlugin } from "@freeholder/plugin-kit";

export default definePlugin({
  name: "social-fixture",
  version: "0.1.0",
  freeholder: ">=0.0.0",
  license: "Apache-2.0",
  permissions: ["social:view", "network:external"],
  requires: ["core", "social"],
  migrations: [],
  capabilities: { adapters: ["social"] },
  services: () => import("./service"),
});
