// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// What a customer sees of the documents sent to them
// (MASTER.md §4.5, C8.11, C8.13).
//
// The same `documents.list` the owner reads, filtered to the caller's own
// contact by the framework rather than by anything here — C8.11's rule, and
// what stops a customer's view of what they were sent and the owner's view of
// the same from ever disagreeing.
//
// Archived documents are excluded. Archiving is the owner saying "this is no
// longer part of the relationship", and a portal that kept showing it would
// make archiving a filing decision with no effect on the person it is about.
import { registerPortalSection } from "@/core/portal/sections";
import { listDocuments } from "./service";

registerPortalSection({
  key: "documents",
  // Before earnings and after the rooms about money owed: a customer looking
  // for the contract they signed is doing something more common than checking
  // a referral balance.
  order: 70,
  load: async (ctx, contactId, limit) => {
    const rows = await ctx.call(listDocuments, { contactId, status: "shared", limit });
    return rows.map((document) => ({
      id: document.id,
      title: document.title,
      status: document.status,
      at: document.updatedAt,
      // Null, like every other room. A share link is a credential and a portal
      // list is not where credentials belong — the emailed link still opens
      // it, and a session-authenticated document page is its own piece of
      // work. `core/portal/sections.ts` explains the rule.
      href: null,
    }));
  },
});
