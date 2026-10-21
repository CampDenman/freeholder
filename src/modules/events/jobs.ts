// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Events background work (C6.11).
//
// The whole promise of a held seat is that it stops being held. A reserved
// registration whose payment deadline passed sits on capacity indefinitely
// and the waitlist behind it never moves — the same failure the waitlist-offer
// and cart-hold sweeps exist to prevent, on the same five-minute cadence.
import { defineJob } from "@/core/jobs";

export const expireHeldRegistrations = defineJob({
  name: "events.expireHeldRegistrations",
  summary: "Release paid seat holds whose payment deadline passed unpaid.",
  schedule: "*/5 * * * *",
  concurrency: 1,
  handler: async () => {
    const { expireHeldRegistrations: expire } = await import("./service");
    return expire.call({}, { kind: "system" });
  },
});

export default [expireHeldRegistrations];
