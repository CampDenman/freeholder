// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Money, as funnel stages (MASTER.md §4.7, C9.07).
//
// `issued_at` rather than `created_at` for the committed band: a draft invoice
// is a note to oneself, and the moment that matters to the customer is the one
// where they were actually asked.
//
// `paid_at` for the paid band, which is a moment rather than a status, so a
// funnel for last month does not change when an old invoice is settled today —
// it credits the month the money arrived, which is the month an owner means.
//
// A refund is not a sixth step. It is what happens after the funnel, and
// drawing it in line would suggest a business wants people to get there.
import { sql } from "drizzle-orm";
import { registerFunnelStage } from "@/core/funnel/stages";
import { invoices, payments, refunds } from "./schema";

registerFunnelStage({
  key: "invoice",
  module: "invoicing",
  band: "committed",
  labelKey: "funnel.stage.invoice",
  definitionKey: "funnel.definition.invoice",
  people: (window) => sql`
    select ${invoices.contactId}::text as person
    from ${invoices}
    where ${invoices.issuedAt} is not null
      and ${invoices.issuedAt} >= ${window.from.toISOString()}::timestamptz
      and ${invoices.issuedAt} < ${window.to.toISOString()}::timestamptz
  `,
});

registerFunnelStage({
  key: "paid",
  module: "invoicing",
  band: "paid",
  labelKey: "funnel.stage.paid",
  definitionKey: "funnel.definition.paid",
  people: (window) => sql`
    select ${invoices.contactId}::text as person
    from ${invoices}
    where ${invoices.paidAt} is not null
      and ${invoices.paidAt} >= ${window.from.toISOString()}::timestamptz
      and ${invoices.paidAt} < ${window.to.toISOString()}::timestamptz
  `,
});

registerFunnelStage({
  key: "refunded",
  module: "invoicing",
  band: "returned",
  labelKey: "funnel.stage.refunded",
  definitionKey: "funnel.definition.refunded",
  // Through the payment to the invoice, because a refund knows which payment
  // it reverses and the invoice is the only place the person is named.
  people: (window) => sql`
    select ${invoices.contactId}::text as person
    from ${refunds}
    join ${payments} on ${payments.id} = ${refunds.paymentId}
    join ${invoices} on ${invoices.id} = ${payments.invoiceId}
    where ${refunds.status} = 'succeeded'
      and ${refunds.processedAt} is not null
      and ${refunds.processedAt} >= ${window.from.toISOString()}::timestamptz
      and ${refunds.processedAt} < ${window.to.toISOString()}::timestamptz
  `,
});
