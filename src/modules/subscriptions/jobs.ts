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
    const { renewDue } = await import("./service");
    return renewDue.call({}, { kind: "system" });
  },
});

export default [renewSubscriptions];
