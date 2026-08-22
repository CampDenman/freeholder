// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// A calendar's subscribable feed (C6.06, MASTER.md §4.4).
//
// The token *is* the authorisation. There is no session here on purpose: a
// calendar app subscribing to a feed sends no cookies, and requiring one would
// mean the feed only worked in a browser — which is the one place an owner
// does not need it.
//
// So the token is treated as the credential it is: unguessable, rotatable in
// one click, and never indexed or cached by anything in between.
import { ready } from "@/core/runtime";
import { getService } from "@/core/service";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ token: string }> },
): Promise<Response> {
  // Boot before the registry is asked for anything. A route module can be the
  // first thing a cold process runs, and `getService` on an empty registry
  // throws rather than answering — which is a 500 on a feed a calendar app
  // polls, for a token that is perfectly valid.
  await ready();
  const { token } = await context.params;
  const headers = {
    "content-type": "text/calendar; charset=utf-8",
    // A diary is not something to leave in a shared cache.
    "cache-control": "no-store, max-age=0, private",
    "x-robots-tag": "noindex, nofollow",
    "content-disposition": 'inline; filename="calendar.ics"',
  };

  const feed = (await getService("calendars.feed").call({ token }, { kind: "anonymous" })) as
    | { name: string; body: string }
    | null;
  if (!feed) {
    // Deliberately the same answer as a revoked token: a 404 that distinguished
    // "never existed" from "was withdrawn" would confirm the second.
    return new Response("Not found", { status: 404, headers: { "cache-control": "no-store" } });
  }
  return new Response(feed.body, { status: 200, headers });
}
