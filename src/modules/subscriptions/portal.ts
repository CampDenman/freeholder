// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The customer's own subscriptions, in the portal (MASTER.md §4.15, C9.13).
//
// §4.15 calls self-service mandatory and gives the reason plainly: "Every
// cancellation an owner has to process by email is a support cost and, in
// several jurisdictions, a legal exposure ('click to cancel' rules)." So the
// room shows what somebody is paying for and when it next renews, and
// `subscriptions.cancelMine` lets them stop it without asking anyone.
//
// The list is the same query admin uses, filtered to the signed-in customer:
// a second audience for a query, never a second implementation of it.
import { registerPortalSection } from "@/core/portal/sections";
import { listSubscriptions } from "./service";

registerPortalSection({
  key: "subscriptions",
  order: 25,
  load: async (ctx, contactId, limit) => {
    const rows = await ctx.call(listSubscriptions, { contactId, limit });
    return rows.map((subscription) => ({
      id: subscription.id,
      title: subscription.status === "trialing" ? "Trial" : "Subscription",
      status: subscription.status,
      // The date that matters to the person paying: when it renews, or when it
      // stops if they have already asked it to.
      at: subscription.currentPeriodEnd,
      href: null,
    }));
  },
});
