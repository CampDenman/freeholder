// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Owner-configured calculators (MASTER.md 4.18, C5.26).
//
// Requires cms for the block a visitor meets. It does not require the
// attestations that supply its constants, because those are core: a calculator
// depends on published figures the way every module depends on the spine.
import { defineModule } from "@/core/module";

export default defineModule({
  name: "calculators",
  version: "0.1.0",
  requires: ["core", "cms"],
  tables: () => import("./tables"),
  services: () => import("./service"),
  events: {
    emits: ["calculator.published", "calculator.closed"],
  },
});
