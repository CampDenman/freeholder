// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Memberships and recurring billing (MASTER.md §4.15, C9.13).
//
// It requires `catalog` because a plan is a product's shape and the price is
// the variant's, and `invoicing` because every period raises §4.6's single
// money object rather than a total of its own.
import { defineModule } from "@/core/module";

export default defineModule({
  name: "subscriptions",
  version: "0.1.0",
  requires: ["core", "catalog", "invoicing"],
  tables: () => import("./tables"),
  services: () => import("./service"),
  jobs: () => import("./jobs"),
  events: {
    emits: [
      "plan.created",
      "subscription.created",
      "subscription.renewed",
      "subscription.paymentFailed",
      "subscription.paused",
      "subscription.resumed",
      "subscription.cancelled",
      "subscription.expired",
      "subscription.dunning",
      "subscription.planChanged",
    ],
    listens: {
      "invoice.paid": "onInvoicePaid",
    },
  },
});
