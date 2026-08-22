// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The rentals module (MASTER.md §11, §4.2, C6.10).
//
// `requires: ["core", "catalog"]` and nothing else, which is the whole shape
// of the feature: a hire is a **catalogue variant** whose **availability is a
// core resource calendar**. §4.2 refuses a second availability model, so this
// module owns no calendar, no slot resolver and no double-booking check — it
// reserves through `bookings.create` and lets the exclusion constraint in the
// database do the work it already does for a massage room.
//
// What is left is what is genuinely different about handing an object to
// somebody: a rate per hour, day or week, a deposit, what it is worth if it
// does not come back, and the four moments a booking has no concept of.
import { defineModule } from "@/core/module";

export default defineModule({
  name: "rentals",
  version: "0.1.0",
  requires: ["core", "catalog"],
  tables: () => import("./tables"),
  services: () => import("./service"),
  events: {
    emits: ["rental.reserved", "rental.out", "rental.overdue", "rental.returned"],
  },
});
