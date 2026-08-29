// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Loyalty (MASTER.md §4.13, C9.11).
//
// `requires` is core and nothing else, and that is the point. §4.13: "Earning
// is a listener on spine events, never a call from inside another module …
// Commerce does not know loyalty exists." The reverse has to hold too, or the
// independence is only rhetorical: this module never imports catalog,
// bookings or quotes, so a business running none of them still has a working
// loyalty programme, and one running all of them did not have to wire them up.
//
// What it listens to is a fixed list of *named* topics. The wildcard exists
// (`ALL_EVENTS`) and is deliberately not used here — its own documentation
// says it is "a fan-out seam, not a way for a module to observe another
// module's traffic, which §11 routes through named events on purpose."
//
// Every handler resolves the spine row the emitting transaction already
// wrote, because that row carries the contact and the money and the bus
// payload carries neither. See `spine.ts` for the one place that mapping
// lives.
import { defineModule } from "@/core/module";

export default defineModule({
  name: "loyalty",
  version: "0.1.0",
  requires: ["core"],
  tables: () => import("./tables"),
  services: () => import("./service"),
  jobs: () => import("./jobs"),
  events: {
    emits: [
      "loyalty.enrolled",
      "loyalty.pointsEarned",
      "loyalty.pointsReversed",
      "loyalty.pointsExpired",
      "loyalty.expiryNoticed",
      "loyalty.redeemed",
      "loyalty.promoted",
      "loyalty.demoted",
    ],
    listens: {
      // Earning moments.
      "catalog.orderPaid": "onSpineEvent",
      "quote.accepted": "onSpineEvent",
      "project.completed": "onSpineEvent",
      "contact.created": "onSpineEvent",
      // Reversal moments. §4.13: "A refund reverses the earn." The same
      // handler serves both, because whether a rule earns or a reversal
      // applies is a property of the event, not of the wiring.
      "catalog.orderCancelled": "onSpineEvent",
      "invoice.refunded": "onSpineEvent",
    },
  },
});
