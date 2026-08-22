// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The contracts module (MASTER.md §11, §4.3, C6.09).
//
// Half a module on purpose. What ships here is the *signed instance* — the
// body as it was read, the signature and its evidence, and the click that
// produced them — because a booking cannot require a waiver until something
// can hold one. C6.14 adds the authoring half: templates with variables,
// countersignature and document export, rendering into the same
// `bodySnapshot` rather than replacing it.
//
// Booking never imports this. Core scheduling asks the registry whether
// `contracts.issue` exists, so an instance running without the module has
// bookings that simply have no waiver to sign — which is the normal state of
// most businesses rather than a degraded one.
import { defineModule } from "@/core/module";

export default defineModule({
  name: "contracts",
  version: "0.1.0",
  requires: ["core"],
  tables: () => import("./tables"),
  services: () => import("./service"),
  events: {
    emits: ["contract.issued", "contract.signed"],
  },
});
