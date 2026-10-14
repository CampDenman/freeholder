// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Members (MASTER.md §44, C12.01). Requires only core: every later member
// feature (profiles, graph, posts, messages, calls, marketplace) builds on it.
import { defineModule } from "@/core/module";

export default defineModule({
  name: "members",
  version: "0.1.0",
  requires: ["core"],
  tables: () => import("./tables"),
  services: () => import("./service"),
  events: {
    emits: ["member.joined", "member.approved", "member.suspended", "member.reactivated"],
  },
});
