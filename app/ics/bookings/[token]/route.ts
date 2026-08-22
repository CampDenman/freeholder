// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// One appointment, for the customer's own calendar (C6.06, MASTER.md §4.4).
//
// Reached by the reschedule token, which is already the unguessable thing this
// customer holds for this appointment — §4.4 gives it to them precisely so
// they never need a login or a support email. A second token would be a second
// thing to leak.
//
// It carries less than the owner's feed: when, where, and which calendar. Not
// the notes, which the owner wrote for themselves.
import { getService } from "@/core/service";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ token: string }> },
): Promise<Response> {
  const { token } = await context.params;
  const feed = (await getService("bookings.ics").call({ token }, { kind: "anonymous" })) as
    | { body: string }
    | null;
  if (!feed) {
    return new Response("Not found", { status: 404, headers: { "cache-control": "no-store" } });
  }
  return new Response(feed.body, {
    status: 200,
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "cache-control": "no-store, max-age=0, private",
      "x-robots-tag": "noindex, nofollow",
      "content-disposition": 'attachment; filename="appointment.ics"',
    },
  });
}
