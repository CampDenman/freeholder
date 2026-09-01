// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Sending, in the background (C9.06, MASTER.md §30).
//
// Pressing "send" starts a broadcast; it does not send it. A campaign to ten
// thousand people is not one request and not one transaction — so `start`
// freezes the audience and returns, and this job carries the send forward one
// committed batch at a time. A crash costs a batch, never the campaign.
//
// Every minute, because a scheduled send should go out at roughly the minute
// it was scheduled for, and because `tick` does nothing at all when there is
// nothing due.
import { defineJob } from "@/core/jobs";

export const tickBroadcasts = defineJob({
  name: "newsletters.tickBroadcasts",
  summary: "Start scheduled broadcasts and send the next batch of each sending one.",
  schedule: "* * * * *",
  // One sender. Two workers picking up the same broadcast would race for the
  // same pending rows, and while the unique index would stop a double send, it
  // would do so by failing a batch rather than by not trying.
  concurrency: 1,
  handler: async () => {
    const { tick } = await import("./broadcast-service");
    return tick.call({}, { kind: "system" });
  },
});

export default [tickBroadcasts];
