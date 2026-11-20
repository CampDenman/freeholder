// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The member's own renewal register, in the portal (MASTER.md §43 C8.11, C12.40).
//
// `renewalAlerts.list` already takes a `contactId`, so this is that query with
// that filter rather than a second read path — the same reasoning C8.11 gives
// for every other room. The room is the dashboard: there is no bespoke list
// page, because `app/portal/(account)/[section]` already renders one and a
// hand-written twin is how two lists of the same rows start disagreeing.
//
// What the room shows in the status slot is the **cycle**, not the status.
// `load` only ever returns active rows, so "Active" on every line would be
// decoration; "Monthly" beside a date is the thing a person actually reads.
import { registerPortalSection } from "@/core/portal/sections";
import { ServiceError } from "@/core/service";
import { renewalAlertsEnabled } from "./settings";
import {
  getTrackedSubscription,
  listTrackedSubscriptions,
  untrackMySubscription,
} from "./service";

registerPortalSection({
  key: "renewals",
  // After the site's own subscriptions (25): what we bill you comes before
  // what somebody else bills you.
  order: 26,
  // The one thing the generic room cannot infer. Every other portal room is a
  // list of records somebody else created; this is a register the member keeps
  // themselves, so the room needs a way in.
  add: { href: "/portal/renewals/new", labelKey: "renewals.add" },
  available: (ctx) => renewalAlertsEnabled(ctx.tx),
  cancelCopy: { buttonKey: "renewals.stop", confirmationKey: "renewals.confirmStop" },
  load: async (ctx, contactId, limit) => {
    const rows = await ctx.call(listTrackedSubscriptions, {
      contactId,
      status: "active",
      limit,
    });
    return rows.map((tracked) => ({
      id: tracked.id,
      title: tracked.name,
      status: tracked.cycle,
      statusKey: `renewals.cycle.${tracked.cycle}`,
      // The date that matters: when somebody else is going to charge them.
      at: tracked.nextRenewalAt,
      href: `/portal/records/renewals/${tracked.id}`,
      amountMinor: tracked.costMinor,
      currency: tracked.currency,
    }));
  },
  detail: async (ctx, contactId, id) => {
    const { subscription, alerts } = await ctx.call(getTrackedSubscription, {
      id,
      contactId,
    });
    // ISO-8601 on purpose: `formatCustomerValue` turns exactly this shape into
    // the member's own locale and timezone, so the field carries the instant
    // and the page decides how to say it.
    const fields = [
      { labelKey: "renewals.field.alertDays", value: String(subscription.alertDays) },
      { labelKey: "renewals.field.firstCharge", value: subscription.firstChargeAt.toISOString() },
      ...(subscription.cycle === "custom" && subscription.customIntervalDays
        ? [
            {
              labelKey: "renewals.field.intervalDays",
              value: String(subscription.customIntervalDays),
            },
          ]
        : []),
      // Answered from rows, which is the whole reason `renewal_alerts` is
      // append-only: "were we told about the March charge?" has a row.
      { labelKey: "renewals.field.alertsSent", value: String(alerts.length) },
      ...(alerts[0]
        ? [{ labelKey: "renewals.field.lastAlert", value: alerts[0].renewalAt.toISOString() }]
        : []),
      ...(subscription.notes
        ? [{ labelKey: "renewals.field.notes", value: subscription.notes }]
        : []),
    ];
    return {
      fields,
      links: [{ labelKey: "renewals.edit", href: `/portal/renewals/${subscription.id}/edit` }],
      // "Stop warning me" is the only destructive thing on offer, and it
      // archives rather than deletes — see `renewalAlerts.untrackMine`.
      actions: ["cancel" as const],
    };
  },
  act: async (ctx, contactId, id, input) => {
    if (input.action !== "cancel") {
      throw new ServiceError("permission", "That action is not available.");
    }
    // Runs under the member's own actor, so the service resolves the contact
    // from the session exactly as it does for the form. `contactId` is already
    // proven by `portal.actOnMyRecord`; passing it here as well would be a
    // second, weaker check of the same fact.
    void contactId;
    await ctx.call(untrackMySubscription, { id });
    // Back to the room: the record it was on is no longer in the room's list,
    // and redirecting to a page that will 404 is a worse end than a list.
    return { href: "/portal/renewals" };
  },
});
