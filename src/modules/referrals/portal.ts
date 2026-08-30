// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// What a referrer sees of their own earnings (MASTER.md §4.13, C8.11, C9.10).
//
// C8.11's registry anticipated this room by name: "referral earnings
// (C9.09–C9.10) will appear here when those modules exist, without this file
// or any page changing." Registering is the whole of the work — there is no
// page below, because the portal already renders any room a module claims.
//
// The list is the same `referrals.commissions` query the owner reads, filtered
// to the caller's own contact by the framework rather than by anything here.
// That is C8.11's rule — "using the same services as admin" — and it is what
// stops an affiliate's view of their earnings and the owner's view of the same
// earnings from ever disagreeing.
import { registerPortalSection } from "@/core/portal/sections";
import { commissions } from "./commission-service";

registerPortalSection({
  key: "earnings",
  // After the rooms about what somebody bought. A referrer is a customer
  // first; being paid is the unusual thing about them, not the main thing.
  order: 80,
  load: async (ctx, contactId, limit) => {
    const rows = await ctx.call(commissions, { affiliateContactId: contactId, limit });
    return rows.map((event) => ({
      id: event.id,
      // Named by what it was for. "Commission" alone would be the same word
      // on every line of a list whose whole purpose is telling them apart.
      title: event.conversionType,
      status: event.status,
      at: event.payableAt,
      href: null,
      amountMinor: event.amountMinor,
      currency: event.currency,
    }));
  },
});
