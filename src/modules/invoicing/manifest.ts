// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The convergent money module (MASTER.md §4.3, §4.12, C5.02-C5.05).
import { defineModule } from "@/core/module";

export default defineModule({
  name: "invoicing",
  version: "0.1.0",
  requires: ["core"],
  tables: () => import("./tables"),
  services: () => import("./service"),
  events: {
    emits: [
      "invoice.created",
      "invoice.sent",
      "invoice.viewed",
      "invoice.overdue",
      "invoice.voided",
      "invoice.partiallyPaid",
      "invoice.paid",
      "invoice.refunded",
      "payment.created",
      "payment.processing",
      "payment.succeeded",
      "payment.failed",
      "payment.cancelled",
      "refund.created",
      "refund.processing",
      "refund.succeeded",
      "refund.failed",
      "refund.cancelled",
      "creditNote.created",
      "creditNote.issued",
      "creditNote.voided",
    ],
  },
});
