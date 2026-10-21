// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Events and classes (MASTER.md C6.11, C2.21).
//
// It requires `invoicing` because paid admission raises §4.3's single money
// object: a held seat is an issued invoice, settlement confirms the seat, and
// a refund or void cancels it — heard here through `listens`.
import { defineModule } from "@/core/module";

export default defineModule({
  name: "events",
  version: "0.1.0",
  requires: ["core", "cms", "invoicing"],
  tables: () => import("./tables"),
  services: () => import("./service"),
  jobs: () => import("./jobs"),
  blocks: () => import("./blocks"),
  onboarding: () => import("./onboarding"),
  events: {
    emits: [
      "events.created",
      "events.updated",
      "events.published",
      "events.cancelled",
      "events.sessionAdded",
      "events.registered",
      "events.waitlisted",
      "events.promoted",
      "events.checkedIn",
    ],
    listens: {
      "invoice.refunded": "onInvoiceRefunded",
      "invoice.voided": "onInvoiceVoided",
    },
  },
});
