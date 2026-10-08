// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The customer's own hires, in the portal (MASTER.md §43 C8.11).
//
// What they have out, and when it is due back. The due date is the whole
// reason somebody opens this room.
//
// The service is the one admin already uses, filtered to the signed-in
// customer's own contact. C8.11 asks for exactly that: a second audience for
// a query, never a second implementation of it.
import { registerPortalSection } from "@/core/portal/sections";
import { listHires } from "./service";

registerPortalSection({
  key: "rentals",
  order: 60,
  detail: async(ctx,contactId,id)=>{
    const hire=(await ctx.call(listHires,{contactId,limit:200})).find(row=>row.id===id);
    if(!hire)throw new Error("Rental ownership changed.");
    return {fields:[{labelKey:"portal.record.starts",value:hire.startsAt.toISOString()},{labelKey:"portal.record.ends",value:hire.dueAt.toISOString()},{labelKey:"portal.record.description",value:hire.sku}],links:hire.invoiceId?[{labelKey:"portal.record.invoice",href:`/portal/invoices/${hire.invoiceId}`}]:[]};
  },
  load: async (ctx, contactId, limit) => {
    const rows = await ctx.call(listHires, { contactId, limit });
    return rows.map((hire) => ({
      id: hire.id,
      title: hire.id.slice(0, 8),
      status: hire.status,
      at: hire.dueAt ?? hire.startsAt ?? null,
      href: `/portal/records/rentals/${hire.id}`,
      amountMinor: hire.quotedMinor,
      currency: hire.currency,
    }));
  },
});
