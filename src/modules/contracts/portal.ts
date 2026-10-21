// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The customer's own agreements, in the portal (MASTER.md §43 C8.11).
//
// An agreement is the record of what was promised, so a customer should never
// have to search an inbox to find out what they signed.
//
// The service is the one admin already uses, filtered to the signed-in
// customer's own contact. C8.11 asks for exactly that: a second audience for
// a query, never a second implementation of it.
import { registerPortalSection } from "@/core/portal/sections";
import { listContracts } from "./service";

registerPortalSection({
  key: "contracts",
  order: 20,
  load: async (ctx, contactId, limit) => {
    const rows = await ctx.call(listContracts, { contactId, limit });
    return rows.map((doc) => ({
      id: doc.id,
      title: doc.title,
      status: doc.status,
      at: doc.signedAt ?? doc.issuedAt ?? null,
      href: null,
    }));
  },
});
