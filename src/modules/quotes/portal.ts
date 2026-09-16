// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The customer's own quotes, in the portal (MASTER.md §43 C8.11).
//
// `quotes.list` already takes a `contactId`, because an owner needed to ask
// "what has this person been offered?". A customer asking that about
// themselves is the same query with the same filter, so this calls it rather
// than growing a second read path that could one day answer differently.
//
// No link: `quotes.list` deliberately omits `view_token` — its own comment
// says naming the columns one by one is what keeps a credential out of "every
// list, log and screenshot" — and a portal room is exactly such a list.
import { registerPortalSection } from "@/core/portal/sections";
import { listQuotes } from "./service";

registerPortalSection({
  key: "quotes",
  order: 10,
  load: async (ctx, contactId, limit) => {
    const rows = await ctx.call(listQuotes, { contactId, limit });
    return rows.map((quote) => ({
      id: quote.id,
      title: quote.title || quote.reference,
      status: quote.status,
      at: quote.sentAt ?? quote.validUntil ?? null,
      href: null,
      amountMinor: quote.totalMinor,
      currency: quote.currency,
    }));
  },
});
