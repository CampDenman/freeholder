// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// One catalog for every kind of sellable value (MASTER.md §4.2, C5.09).
import { defineModule } from "@/core/module";

export default defineModule({
  name: "catalog",
  version: "0.1.0",
  requires: ["core", "cms", "invoicing"],
  tables: () => import("./tables"),
  services: () => import("./service"),
  events: {
    emits: [
      "catalog.productCreated",
      "catalog.productUpdated",
      "catalog.productActivated",
      "catalog.productArchived",
      "catalog.productRestored",
      "catalog.productVisibilityChanged",
    ],
  },
});
