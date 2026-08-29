// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The customer's own orders, in the portal (MASTER.md §43 C8.11).
//
// Orders and their returns. A customer who cannot see what they bought will
// ask the owner, and that is a support conversation the record could have had.
//
// The service is the one admin already uses, filtered to the signed-in
// customer's own contact. C8.11 asks for exactly that: a second audience for
// a query, never a second implementation of it.
import { registerPortalSection } from "@/core/portal/sections";
import { listOrders } from "./orders";

registerPortalSection({
  key: "orders",
  order: 50,
  // `catalog.listOrders` takes no limit; the room asks for everything this
  // person bought and shows the newest first, which is the order it returns.
  load: async (ctx, contactId) => {
    const rows = await ctx.call(listOrders, { contactId });
    return rows.map((order) => ({
      id: order.id,
      title: order.id.slice(0, 8),
      status: order.status,
      at: order.createdAt,
      href: null,
      amountMinor: order.totalMinor,
      currency: order.currency,
    }));
  },
});
