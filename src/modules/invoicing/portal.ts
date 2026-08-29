// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The customer's own invoices, in the portal (MASTER.md §43 C8.11).
//
// The money half of C8.11. What is owed, what is paid, and when — from the
// same ledger the owner reads, so the two can never quote different numbers.
//
// The service is the one admin already uses, filtered to the signed-in
// customer's own contact. C8.11 asks for exactly that: a second audience for
// a query, never a second implementation of it.
import { registerPortalSection } from "@/core/portal/sections";
import { listInvoices } from "./invoice-service";

registerPortalSection({
  key: "invoices",
  order: 30,
  load: async (ctx, contactId, limit) => {
    const rows = await ctx.call(listInvoices, { contactId, limit });
    return rows.map((invoice) => ({
      id: invoice.id,
      title: invoice.number ?? invoice.id.slice(0, 8),
      status: invoice.status,
      at: invoice.issuedAt ?? invoice.createdAt ?? null,
      href: null,
      amountMinor: invoice.totalMinor,
      currency: invoice.currency,
    }));
  },
});
