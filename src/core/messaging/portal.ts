// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The customer's own conversations, in the portal (MASTER.md §43 C8.11).
//
// One thread with one business, from the customer's side. §4.14 already made
// the Conversation the single thread per person; this is that thread, read by
// the person it is with.
//
// The service is the one admin already uses, filtered to the signed-in
// customer's own contact. C8.11 asks for exactly that: a second audience for
// a query, never a second implementation of it.
import { registerPortalSection } from "@/core/portal/sections";
import { listConversations } from "./service";

registerPortalSection({
  key: "messages",
  order: 80,
  load: async (ctx, contactId, limit) => {
    const rows = await ctx.call(listConversations, { contactId, limit });
    return rows.map((thread) => ({
      id: thread.id,
      title: thread.subject ?? thread.threadKey ?? thread.id.slice(0, 8),
      status: thread.status,
      at: thread.lastInboundAt ?? thread.lastOutboundAt ?? null,
      href: null,
    }));
  },
});
