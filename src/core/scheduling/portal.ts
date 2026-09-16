// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The customer's own bookings, in the portal (MASTER.md §43 C8.11).
//
// Bookings live in core rather than a module, so this registers from core —
// which is allowed in the direction that matters: core is not importing a
// module, it is one part of core telling another what it can show.
//
// The service is the one admin already uses, filtered to the signed-in
// customer's own contact. C8.11 asks for exactly that: a second audience for
// a query, never a second implementation of it.
import { registerPortalSection } from "@/core/portal/sections";
import { listBookings } from "./bookings";

registerPortalSection({
  key: "bookings",
  order: 40,
  load: async (ctx, contactId, limit) => {
    const rows = await ctx.call(listBookings, { contactId, limit });
    return rows.map((booking) => ({
      id: booking.id,
      title: booking.calendarName,
      status: booking.status,
      at: booking.startsAt ?? null,
      href: null,
    }));
  },
});
