// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { defineModule } from "@/core/module";

export default defineModule({
  name: "builder",
  version: "0.1.0",
  requires: ["core", "cms"],
  tables: () => import("./tables"),
  services: () => import("./service"),
  events: {
    emits: ["builder.proposalCreated", "builder.proposalApplied", "builder.proposalRolledBack"],
  },
});
