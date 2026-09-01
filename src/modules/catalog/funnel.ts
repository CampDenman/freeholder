// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Shopping, as funnel stages (MASTER.md §4.7, C9.07).
//
// A cart is only interest once somebody is attached to it. Anonymous carts
// exist and matter — C5.20's abandonment work is about them — but this funnel
// counts people, and a cart with no contact cannot be told apart from the next
// one. Counting them would inflate the middle of the funnel with the same
// stranger several times over.
//
// Payment is deliberately not here. A shop order is paid through an invoice
// like everything else, so `invoicing` answers for the paid band and this
// module does not grow a second, quieter answer to "did they pay".
import { sql } from "drizzle-orm";
import { registerFunnelStage } from "@/core/funnel/stages";
import { carts, orders } from "./schema";

registerFunnelStage({
  key: "cart",
  module: "catalog",
  band: "interest",
  labelKey: "funnel.stage.cart",
  definitionKey: "funnel.definition.cart",
  people: (window) => sql`
    select ${carts.contactId}::text as person
    from ${carts}
    where ${carts.contactId} is not null
      and ${carts.createdAt} >= ${window.from.toISOString()}::timestamptz
      and ${carts.createdAt} < ${window.to.toISOString()}::timestamptz
  `,
});

registerFunnelStage({
  key: "order",
  module: "catalog",
  band: "committed",
  labelKey: "funnel.stage.order",
  definitionKey: "funnel.definition.order",
  people: (window) => sql`
    select ${orders.contactId}::text as person
    from ${orders}
    where ${orders.contactId} is not null
      and ${orders.createdAt} >= ${window.from.toISOString()}::timestamptz
      and ${orders.createdAt} < ${window.to.toISOString()}::timestamptz
  `,
});
