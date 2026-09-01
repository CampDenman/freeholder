// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Booked time, as a funnel stage (MASTER.md §4.7, C9.07).
//
// Counted when the booking was made, not when it happens: a January funnel
// should credit January for the appointment somebody booked in January, even
// if it falls in March. Reporting on `starts_at` would move the same customer
// between periods depending on how far ahead they book, which is a property of
// the calendar rather than of the business.
//
// Cancelled bookings still count as interest, because they were. What became
// of them belongs to the bands after this one.
import { sql } from "drizzle-orm";
import { registerFunnelStage } from "@/core/funnel/stages";
import { bookings } from "./schema";

registerFunnelStage({
  key: "booking",
  module: "core",
  band: "interest",
  labelKey: "funnel.stage.booking",
  definitionKey: "funnel.definition.booking",
  people: (window) => sql`
    select ${bookings.contactId}::text as person
    from ${bookings}
    where ${bookings.contactId} is not null
      and ${bookings.createdAt} >= ${window.from.toISOString()}::timestamptz
      and ${bookings.createdAt} < ${window.to.toISOString()}::timestamptz
  `,
});
