// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Revenue by place (MASTER.md §4.7, §43 C9.08).
//
// Registered here rather than in `core/scheduling`, which is where bookings
// live, because the join needs the invoice and §11 forbids core importing a
// module. The invoice is this module's, and both halves of the rest —
// `core/scheduling`'s booking and `core/locations`' place — are core, which a
// module may read freely.
//
// Bookings only, and the definition on the screen says so rather than leaving
// an owner to assume otherwise. A shop with two counters would want its orders
// counted here too, and today they are not: an order records where it shipped,
// not where it was rung up, and inferring one from the other would produce a
// number that looks right and is not. An honest gap an owner can read beats a
// figure they would have to disprove.
import { sql } from "drizzle-orm";
import { registerRevenueSource } from "@/core/reporting/dimensions";
import { businessLocations } from "@/core/locations/schema";
import { bookings } from "@/core/scheduling/schema";
import { invoices } from "./schema";

registerRevenueSource({
  dimension: "location",
  module: "invoicing",
  basis: "invoice",
  definitionKey: "reports.definition.locationBookings",
  rows: (window) => sql`
    select ${invoices.id} as invoice_id,
           ${businessLocations.name} as bucket,
           0::bigint as amount_minor
    from ${bookings}
    join ${invoices} on ${invoices.id} = ${bookings.invoiceId}
    join ${businessLocations} on ${businessLocations.id} = ${bookings.locationId}
    where ${invoices.paidAt} is not null
      and ${invoices.paidAt} >= ${window.from.toISOString()}::timestamptz
      and ${invoices.paidAt} < ${window.to.toISOString()}::timestamptz
  `,
});
