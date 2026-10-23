// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { z } from "zod";
import { formatDateTimeRange, formatDateTimeShort, formatMoney } from "@/core/i18n";
import { defineBlock } from "@/modules/cms/blocks/types";
import { env } from "@/core/env";
import { failureFromQuery, failureMessageKey } from "@/core/http/public-form-return";
import { registerForEventAction } from "../../../app/(public)/event-actions";

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
    // A finished event keeps its page — people link to it, and it is the
    // record that the class happened — but it is filed under "Past events"
    // rather than offered alongside the ones still open.
    const upcoming = resolved.filter((event) => !event.endedAt);
    const past = resolved.filter((event) => event.endedAt);
    const item = (event: (typeof resolved)[number]) => (
      <li key={event.id} className="border-b border-rule pb-4 last:border-0">
        <a
          href={ctx.localizeHref?.(`/events/${event.slug}`) ?? `/events/${event.slug}`}
          className="font-semibold text-ink"
        >
          {event.name}
        </a>
        {event.nextStartsAt && event.nextEndsAt && event.nextTimezone ? (
          <p className="mt-1 text-sm text-ink-muted">
            <time dateTime={event.nextStartsAt.toISOString()}>
              {formatDateTimeRange(event.nextStartsAt, event.nextEndsAt, event.nextTimezone, ctx.locale)}
            </time>
          </p>
        ) : null}
        {event.summary ? <p className="mt-1 text-sm text-ink-muted">{event.summary}</p> : null}
      </li>
    );
    return (
      <div className="grid gap-8">
        {upcoming.length > 0 ? (
          <ul className="grid list-none gap-4 p-0">{upcoming.map(item)}</ul>
        ) : (
          <p className="text-ink-muted">{ctx.t("events.index.noneUpcoming")}</p>
        )}
        {past.length > 0 ? (
          <section aria-labelledby="events-past-heading" className="grid gap-4">
            <h2 id="events-past-heading" className="text-xl font-semibold text-ink">
              {ctx.t("events.index.past")}
            </h2>
            <ul className="grid list-none gap-4 p-0">{past.map(item)}</ul>
          </section>
        ) : null}
      </div>
    );
  },
});

// 16px controls, not 14px: iOS Safari zooms the page when a smaller control
// takes focus. The label stays at 14px; only the control clears the threshold.
const control =
  "w-full rounded-md border border-rule-strong bg-field px-3 py-2 text-base text-ink";

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

    // Registration is open only for a published event with a session still
    // ahead; a draft, cancelled or finished event renders no form at all.
    const futureSessions = resolved.sessions.filter(
      (session) => session.startsAt.getTime() > Date.now(),
    );
    const open = resolved.status === "published" && futureSessions.length > 0;
    const tickets = resolved.tickets.filter((ticket) => ticket.active);
    const allFull =
      futureSessions.length > 0 && futureSessions.every((session) => session.remaining === 0);
    const waitlistOnly = allFull && futureSessions.every((session) => session.waitlistEnabled);
    const submitLabel = waitlistOnly
      ? ctx.t("events.register.submitWaitlist")
      : tickets.length > 0 && tickets.every((ticket) => ticket.priceMinor > 0)
        ? ctx.t("events.register.submitPaid")
        : ctx.t("events.register.submit");

    const registered = ctx.query?.eventRegistered === resolved.slug;
    const waitlisted = ctx.query?.eventWaitlisted === resolved.slug;
    const failed = ctx.query?.eventError === resolved.slug;
    const formId = `event-${resolved.id}`;

    return (
      <div className="grid gap-3">
        {resolved.summary ? <p className="text-lg text-ink-muted">{resolved.summary}</p> : null}
        {resolved.status === "published" &&
        resolved.sessions.length > 0 &&
        resolved.sessions.every((session) => session.endsAt.getTime() <= Date.now()) ? (
          <p className="text-sm font-semibold text-ink-muted">{ctx.t("events.ended")}</p>
        ) : null}
        {venue ? <p className="text-sm text-ink-muted">{venue}</p> : null}
        {resolved.sessions.length > 0 ? (
          <ul className="grid list-none gap-2 p-0 text-sm">
            {resolved.sessions.map((session) => (
              <li key={session.id}>
                {/* The span reads in the zone the session happens in; the
                    machine-readable start rides on <time> (an HTML datetime
                    is one instant, not an interval). */}
                <time dateTime={session.startsAt.toISOString()}>
                  {formatDateTimeRange(session.startsAt, session.endsAt, session.timezone, ctx.locale)}
                </time>
                {session.endsAt.getTime() > Date.now() ? (
                  <>
                    {" · "}
                    {ctx.t("events.sessionSeats", {
                      remaining: session.remaining,
                      capacity: session.capacity,
                    })}
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
        <a href={`/ics/events/${resolved.slug}`} className="text-sm font-semibold text-accent">
          {ctx.t("events.addToCalendar")}
        </a>

        {registered ? (
          <p
            role="status"
            className="max-w-prose rounded-md border border-rule bg-success-soft px-4 py-3 text-sm text-success"
          >
            {ctx.t("events.register.success")}
          </p>
        ) : null}
        {waitlisted ? (
          <p
            role="status"
            className="max-w-prose rounded-md border border-rule bg-success-soft px-4 py-3 text-sm text-success"
          >
            {ctx.t("events.register.waitlisted")}
          </p>
        ) : null}

        {open && !registered && !waitlisted ? (
          <form action={registerForEventAction} className="grid max-w-prose gap-4">
            <input type="hidden" name="eventId" value={resolved.id} />
            <input type="hidden" name="eventSlug" value={resolved.slug} />
            {futureSessions.length === 1 ? (
              <input type="hidden" name="sessionId" value={futureSessions[0]!.id} />
            ) : (
              <div className="grid gap-1.5">
                <label htmlFor={`${formId}-session`} className="text-sm font-medium text-ink">
                  {ctx.t("events.register.session")}
                </label>
                <select
                  id={`${formId}-session`}
                  name="sessionId"
                  required
                  className={control}
                >
                  {futureSessions.map((session) => (
                    <option key={session.id} value={session.id}>
                      {session.remaining === 0
                        ? session.waitlistEnabled
                          ? ctx.t("events.register.sessionOptionWaitlist", {
                              starts: formatDateTimeShort(session.startsAt, session.timezone, ctx.locale),
                            })
                          : ctx.t("events.register.sessionOptionFull", {
                              starts: formatDateTimeShort(session.startsAt, session.timezone, ctx.locale),
                            })
                        : ctx.t("events.register.sessionOption", {
                            starts: formatDateTimeShort(session.startsAt, session.timezone, ctx.locale),
                            remaining: session.remaining,
                          })}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {tickets.length === 0 ? null : tickets.length === 1 ? (
              <input type="hidden" name="ticketId" value={tickets[0]!.id} />
            ) : (
              <div className="grid gap-1.5">
                <label htmlFor={`${formId}-ticket`} className="text-sm font-medium text-ink">
                  {ctx.t("events.register.ticket")}
                </label>
                <select
                  id={`${formId}-ticket`}
                  name="ticketId"
                  required
                  className={control}
                >
                  {tickets.map((ticket) => (
                    <option key={ticket.id} value={ticket.id}>
                      {ticket.name}
                      {" — "}
                      {ticket.priceMinor > 0
                        ? formatMoney(ticket.priceMinor, ticket.currency, ctx.locale)
                        : ctx.t("events.register.free")}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {failed ? (
              <p
                role="alert"
                className="rounded-md border border-rule bg-danger-soft px-4 py-3 text-sm text-danger"
              >
                {ctx.t(failureMessageKey(failureFromQuery(ctx.query?.failure), "events.register.error"))}
              </p>
            ) : null}
            <div className="grid gap-1.5">
              <label htmlFor={`${formId}-name`} className="text-sm font-medium text-ink">
                {ctx.t("events.register.name")}
              </label>
              <input
                id={`${formId}-name`}
                name="name"
                type="text"
                autoComplete="name"
                maxLength={200}
                className={control}
              />
            </div>
            <div className="grid gap-1.5">
              <label htmlFor={`${formId}-email`} className="text-sm font-medium text-ink">
                {ctx.t("events.register.email")}
                <span aria-hidden="true" className="text-ink-muted">
                  {" *"}
                </span>
              </label>
              <input
                id={`${formId}-email`}
                name="email"
                type="email"
                required
                autoComplete="email"
                maxLength={320}
                className={control}
              />
              {env().FREEHOLDER_PLAYGROUND === "1" ? (
                <p className="text-xs text-ink-muted">{ctx.t("playground.fictionalHint")}</p>
              ) : null}
            </div>
            <div className="grid gap-1.5">
              <label htmlFor={`${formId}-quantity`} className="text-sm font-medium text-ink">
                {ctx.t("events.register.quantity")}
              </label>
              <input
                id={`${formId}-quantity`}
                name="quantity"
                type="number"
                min={1}
                max={50}
                defaultValue={1}
                required
                className={control}
              />
            </div>
            <button
              type="submit"
              className="inline-flex w-fit items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-on-accent shadow-press"
            >
              {submitLabel}
            </button>
          </form>
        ) : null}
      </div>
    );
  },
});

// Registration happens once, in boot, from the manifest's `blocks` entry.

export default [eventsIndex, eventDetail];
