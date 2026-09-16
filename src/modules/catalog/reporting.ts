// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// What the money was for (MASTER.md §4.7, §43 C9.08).
//
// Two dimensions, answered differently on purpose.
//
// **By product** is a `lines` source: an order puts many products on one
// invoice, so the honest figure is the value of the lines. Splitting the
// invoice's discounts, shipping and tax across products by proportion would
// invent a rounding decision the business never made, and would make a
// per-product total that disagrees with the books by a cent per order.
//
// **By service** is an `invoice` source: a booking is for one service, so the
// invoice belongs wholly to it and the figure is what was actually paid, less
// anything refunded — the truest number available.
//
// A service is a product here (`service_offerings.product_id`), which is why
// this module answers for both: `core/scheduling` owns the booking but cannot
// see what it was a booking *of*, and core may not import a module (§11).
import { sql } from "drizzle-orm";
import { registerRevenueSource } from "@/core/reporting/dimensions";
import { bookings } from "@/core/scheduling/schema";
import { invoices } from "@/modules/invoicing/schema";
import { orderItems, orders, productVariants, products, serviceOfferings } from "./schema";

const paidInWindow = (window: { from: Date; to: Date }) => sql`
  ${invoices.paidAt} is not null
    and ${invoices.paidAt} >= ${window.from.toISOString()}::timestamptz
    and ${invoices.paidAt} < ${window.to.toISOString()}::timestamptz
`;

registerRevenueSource({
  dimension: "product",
  module: "catalog",
  basis: "lines",
  definitionKey: "reports.definition.productCatalog",
  rows: (window) => sql`
    select ${invoices.id} as invoice_id,
           ${products.name} as bucket,
           sum(${orderItems.lineTotalMinor})::bigint as amount_minor
    from ${orders}
    join ${invoices} on ${invoices.id} = ${orders.invoiceId}
    join ${orderItems} on ${orderItems.orderId} = ${orders.id}
    join ${productVariants} on ${productVariants.id} = ${orderItems.variantId}
    join ${products} on ${products.id} = ${productVariants.productId}
    where ${paidInWindow(window)}
    group by ${invoices.id}, ${products.name}
  `,
});

registerRevenueSource({
  dimension: "service",
  module: "catalog",
  basis: "invoice",
  definitionKey: "reports.definition.serviceBookings",
  rows: (window) => sql`
    select ${invoices.id} as invoice_id,
           ${products.name} as bucket,
           0::bigint as amount_minor
    from ${bookings}
    join ${invoices} on ${invoices.id} = ${bookings.invoiceId}
    join ${serviceOfferings} on ${serviceOfferings.id} = ${bookings.serviceOfferingId}
    join ${products} on ${products.id} = ${serviceOfferings.productId}
    where ${paidInWindow(window)}
  `,
});
