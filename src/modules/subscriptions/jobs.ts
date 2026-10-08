// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The calendar, kept (MASTER.md §4.15, C9.13).
//
// Hourly rather than nightly. A period ends at the hour it began, and a
// business that sells a monthly membership at nine in the morning should not
// have its renewals cluster at midnight — nor should a customer who cancels at
// noon keep access until the small hours of the following day.
import { defineJob } from "@/core/jobs";

export const renewSubscriptions = defineJob({
  name: "subscriptions.renewDue",
  summary: "Advance the period of every subscription that has reached its end.",
  schedule: "7 * * * *",
  // One sweep. Two workers picking up the same subscription would both try to
  // raise its invoice, and while the idempotency key would stop the second
  // one, it would do so by failing rather than by not trying.
  concurrency: 1,
  handler: async () => {
    const { chargePlatformDue, renewDue } = await import("./service");
    const manual = await renewDue.call({}, { kind: "system" });
    const platform = await chargePlatformDue.call({}, { kind: "system" });
    return { ...manual, charged: platform.charged };
  },
});

export const advanceDunning = defineJob({
  name: "subscriptions.advanceDunning",
  summary: "Retry a failed renewal, keep access through grace, then take the final action.",
  schedule: "17 * * * *",
  concurrency: 1,
  handler: async () => {
    const { advanceDunning: run } = await import("./service");
    return run.call({}, { kind: "system" });
  },
});

export const finishCustomerSignups = defineJob({
  name: "subscriptions.finishCustomerSignups", summary: "Activate paid signups and recover future provider schedules.", schedule: "* * * * *", concurrency: 1,
  handler: async () => {
    const { finishMembershipSignups, pendingMembershipSchedules } = await import("./public-signup");
    const { attachProviderSchedule } = await import("./billing");
    const result = await finishMembershipSignups.call({}, { kind: "system" });
    const failures: unknown[] = [];
    for (const id of await pendingMembershipSchedules.call({}, { kind: "system" })) {
      try { await attachProviderSchedule.call({ subscriptionId: id }, { kind: "system" }); } catch (error) { failures.push(error); }
    }
    if (failures.length) throw new AggregateError(failures, "Some membership renewal schedules need retrying.");
    return result;
  },
});
export default [renewSubscriptions, advanceDunning, finishCustomerSignups];
