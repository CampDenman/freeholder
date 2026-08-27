// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { z } from "zod";
import { defineBlock } from "@/modules/cms/blocks/types";

export const eventsIndex = defineBlock({
  type: "eventsIndex",
  labelKey: "cms.block.eventsIndex",
  contexts: ["page"],
  schema: z.object({}),
  starter: () => ({}),
  resolve: async () => {
    const { listPublicEvents } = await import("./service");
    return listPublicEvents.call({}, { kind: "anonymous" });
  },
  render: ({ resolved, ctx }) => {
    if (!resolved || resolved.length === 0) return null;
    return (
      <ul className="grid list-none gap-4 p-0">
        {resolved.map((event) => (
          <li key={event.id} className="border-b border-rule pb-4 last:border-0">
            <a
              href={ctx.localizeHref?.(`/events/${event.slug}`) ?? `/events/${event.slug}`}
              className="font-semibold text-ink"
            >
              {event.name}
            </a>
            {event.summary ? <p className="mt-1 text-sm text-ink-muted">{event.summary}</p> : null}
          </li>
        ))}
      </ul>
    );
  },
});

export const eventDetail = defineBlock({
  type: "eventDetail",
  labelKey: "cms.block.eventDetail",
  contexts: ["page"],
  schema: z.object({
    eventId: z.string().uuid(),
    slug: z.string().min(1),
  }),
  starter: () => ({ eventId: "00000000-0000-4000-8000-000000000000", slug: "event" }),
  resolve: async (props) => {
    const { resolvePublicEvent } = await import("./service");
    return resolvePublicEvent.call({ slug: props.slug }, { kind: "anonymous" });
  },
  render: ({ resolved, ctx }) => {
    if (!resolved) return null;
    const venue = [resolved.venueName, resolved.venueAddress].filter(Boolean).join(" — ");
    return (
      <div className="grid gap-3">
        {resolved.summary ? <p className="text-lg text-ink-muted">{resolved.summary}</p> : null}
        {venue ? <p className="text-sm text-ink-muted">{venue}</p> : null}
        {resolved.sessions.length > 0 ? (
          <ul className="grid list-none gap-2 p-0 text-sm">
            {resolved.sessions.map((session) => (
              <li key={session.id}>
                <time dateTime={session.startsAt.toISOString()}>{session.startsAt.toISOString()}</time>
                {" — "}
                <time dateTime={session.endsAt.toISOString()}>{session.endsAt.toISOString()}</time>
                {" · "}
                {ctx.t("events.sessionSeats", {
                  remaining: session.remaining,
                  capacity: session.capacity,
                })}
              </li>
            ))}
          </ul>
        ) : null}
        <a href={`/ics/events/${resolved.slug}`} className="text-sm font-semibold text-accent">
          {ctx.t("events.addToCalendar")}
        </a>
      </div>
    );
  },
});

// Registration happens once, in boot, from the manifest's `blocks` entry.

export default [eventsIndex, eventDetail];
