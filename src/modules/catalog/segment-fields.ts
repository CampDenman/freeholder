// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// What commerce lets a segment ask (MASTER.md §4.14, C7.04).
//
// §4.14's example is "customers in Ontario who bought twice", and *bought* is
// this module's word, not core's. So these fields are registered from here
// rather than listed in core: a shop instance gets them, a photographer's
// instance does not, and neither has a field list that lies about what the
// business can answer.
//
// Every one of them counts **paid** orders rather than every row. A basket
// abandoned at the payment step is not a purchase, and a segment that counted
// it would send "thanks for your order" to somebody who never placed one.
import {
  countOfRelated,
  lastRelatedAt,
  registerSegmentField,
  sumOfRelated,
} from "@/core/segments/service";

const PAID = "t.status in ('paid', 'fulfilling', 'fulfilled')";

registerSegmentField({
  key: "orders.paidCount",
  label: "Orders placed",
  type: "number",
  source: "catalog",
  condition: countOfRelated("orders", PAID),
});

registerSegmentField({
  key: "orders.lastPaidAt",
  label: "Last order",
  type: "date",
  source: "catalog",
  condition: lastRelatedAt("orders", "created_at", PAID),
});

/**
 * Lifetime spend, in minor units (§15.4).
 *
 * A refunded order is excluded along with a cancelled one: money that came back
 * is not money the customer spent, and a "spent over £500" list that included
 * refunds would offer a discount to somebody who returned everything.
 */
registerSegmentField({
  key: "orders.totalSpentMinor",
  label: "Spent in total",
  type: "number",
  source: "catalog",
  condition: sumOfRelated("orders", "total_minor", PAID),
});
