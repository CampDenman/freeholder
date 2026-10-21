// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The projects module's scheduled work.
//
// One job, and it exists because a permission with an end date does not
// announce its own expiry. The publish gate refuses lapsed consent, but a gate
// only fires when somebody pushes on it; work already public would otherwise
// stay public on the strength of a permission that ran out months ago.
import { defineJob } from "@/core/jobs";

export const sweepLapsedProjectConsent = defineJob({
  name: "projects.sweepLapsedConsent",
  summary: "Unpublish client work whose publication permission no longer stands.",
  // Hourly rather than nightly: consent that ran out at noon should not stay
  // published until the small hours of the next morning.
  schedule: "23 * * * *",
  concurrency: 1,
  handler: async () => {
    const { sweepLapsedConsent } = await import("./publishing-service");
    return sweepLapsedConsent.call({}, { kind: "system" });
  },
});

export default [sweepLapsedProjectConsent];
