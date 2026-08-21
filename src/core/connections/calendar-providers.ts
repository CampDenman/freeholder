// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Reading calendars from Google and Microsoft (MASTER.md §41, C4.12).
//
// This is deliberately not the `CalendarAdapter` in `src/adapters/calendar`.
// That boundary exists to *write* a booking into one configured calendar; this
// one exists to *read* every calendar an account can see, incrementally, so
// availability knows what is already taken. Folding both into one interface
// would give every implementation half a job it does not do.
import { requestWithTimeout, providerJson } from "@/adapters/mail/http";
import { MailAdapterError } from "@/adapters/mail/types";
import type { OAuthProvider } from "@/core/connections/oauth-core";

export interface ProviderCalendar {
  externalId: string;
  name: string;
  colour?: string;
  timezone?: string;
}

export interface ProviderEvent {
  externalId: string;
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
  /** False for an event the person marked free: on the calendar, not blocking. */
  busy: boolean;
  /** Only ever read when the account allows details; see `calendar-sync.ts`. */
  title?: string;
  /** Deleted or declined upstream, so the shadow row must go. */
  cancelled: boolean;
}

export interface CalendarSyncPage {
  events: readonly ProviderEvent[];
  /** The cursor to present next time, when the provider issued one. */
  nextSyncToken?: string;
  /**
   * The provider refused the cursor we presented. Not an error: it is the
   * documented way of saying "your cursor is too old, start again".
   */
  resyncRequired: boolean;
}

export interface CalendarWindow {
  startsAt: Date;
  endsAt: Date;
}

export interface CalendarSyncClient {
  listCalendars(accessToken: string): Promise<readonly ProviderCalendar[]>;
  listEvents(
    accessToken: string,
    input: { externalId: string; syncToken?: string | null; window: CalendarWindow },
  ): Promise<CalendarSyncPage>;
}

/**
 * A page is capped well under the shared 256 KB response bound, and a sync is
 * capped in pages. A calendar with more changes than this per run is not
 * dropped: the cursor advances, and the next run picks up where this stopped.
 */
const PAGE_SIZE = 100;
const MAX_PAGES = 20;

/** A provider saying "that cursor is stale", in each provider's dialect. */
function isStaleCursor(error: unknown): boolean {
  if (!(error instanceof MailAdapterError)) return false;
  if (error.httpStatus === 410) return true;
  return (
    error.httpStatus === 400 &&
    (error.providerCode ?? "").toLowerCase().includes("sync")
  );
}

async function getJson<T>(
  url: string,
  accessToken: string,
  label: string,
  headers: Record<string, string> = {},
): Promise<T> {
  const response = await requestWithTimeout(globalThis.fetch, url, {
    method: "GET",
    headers: { authorization: `Bearer ${accessToken}`, accept: "application/json", ...headers },
  });
  return providerJson<T>(response, label);
}

type GoogleCalendarList = {
  items?: {
    id?: string;
    summary?: string;
    summaryOverride?: string;
    backgroundColor?: string;
    timeZone?: string;
    deleted?: boolean;
  }[];
  nextPageToken?: string;
};

type GoogleEventList = {
  items?: {
    id?: string;
    status?: string;
    summary?: string;
    transparency?: string;
    start?: { dateTime?: string; date?: string };
    end?: { dateTime?: string; date?: string };
  }[];
  nextPageToken?: string;
  nextSyncToken?: string;
};

function googleMoment(
  slot: { dateTime?: string; date?: string } | undefined,
): { at: Date; allDay: boolean } | null {
  if (slot?.dateTime) {
    const at = new Date(slot.dateTime);
    return Number.isNaN(at.getTime()) ? null : { at, allDay: false };
  }
  if (slot?.date) {
    // A date without a time is midnight in the calendar's own zone; treating
    // it as UTC is close enough for a busy block and wrong by hours for a
    // booking, which is why nothing books from these rows.
    const at = new Date(`${slot.date}T00:00:00.000Z`);
    return Number.isNaN(at.getTime()) ? null : { at, allDay: true };
  }
  return null;
}

const google: CalendarSyncClient = {
  async listCalendars(accessToken) {
    const found: ProviderCalendar[] = [];
    let pageToken: string | undefined;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const url = new URL("https://www.googleapis.com/calendar/v3/users/me/calendarList");
      url.searchParams.set("maxResults", "250");
      url.searchParams.set("showHidden", "false");
      if (pageToken) url.searchParams.set("pageToken", pageToken);
      const body = await getJson<GoogleCalendarList>(url.toString(), accessToken, "Google");
      for (const item of body.items ?? []) {
        if (!item.id || item.deleted) continue;
        found.push({
          externalId: item.id,
          name: item.summaryOverride ?? item.summary ?? item.id,
          colour: item.backgroundColor,
          timezone: item.timeZone,
        });
      }
      pageToken = body.nextPageToken;
      if (!pageToken) break;
    }
    return found;
  },

  async listEvents(accessToken, input) {
    const events: ProviderEvent[] = [];
    let pageToken: string | undefined;
    let nextSyncToken: string | undefined;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const url = new URL(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(
          input.externalId,
        )}/events`,
      );
      url.searchParams.set("maxResults", String(PAGE_SIZE));
      url.searchParams.set("singleEvents", "true");
      url.searchParams.set("showDeleted", "true");
      if (input.syncToken) {
        // A cursor and a window cannot be combined; the cursor already knows
        // what it last reported. The window is re-established by the periodic
        // full resync in `calendar-sync.ts`.
        url.searchParams.set("syncToken", input.syncToken);
      } else {
        url.searchParams.set("timeMin", input.window.startsAt.toISOString());
        url.searchParams.set("timeMax", input.window.endsAt.toISOString());
        url.searchParams.set("orderBy", "startTime");
      }
      if (pageToken) url.searchParams.set("pageToken", pageToken);

      let body: GoogleEventList;
      try {
        body = await getJson<GoogleEventList>(url.toString(), accessToken, "Google");
      } catch (error) {
        if (input.syncToken && isStaleCursor(error)) {
          return { events: [], resyncRequired: true };
        }
        throw error;
      }
      for (const item of body.items ?? []) {
        if (!item.id) continue;
        const cancelled = item.status === "cancelled";
        const start = googleMoment(item.start);
        const end = googleMoment(item.end);
        if (cancelled) {
          // A cancellation carries an id and often nothing else.
          events.push({
            externalId: item.id,
            startsAt: start?.at ?? new Date(0),
            endsAt: end?.at ?? new Date(0),
            allDay: false,
            busy: false,
            cancelled: true,
          });
          continue;
        }
        if (!start || !end || end.at <= start.at) continue;
        events.push({
          externalId: item.id,
          startsAt: start.at,
          endsAt: end.at,
          allDay: start.allDay,
          busy: item.transparency !== "transparent",
          title: item.summary,
          cancelled: false,
        });
      }
      nextSyncToken = body.nextSyncToken ?? nextSyncToken;
      pageToken = body.nextPageToken;
      if (!pageToken) break;
    }
    return { events, nextSyncToken, resyncRequired: false };
  },
};

type GraphCalendarList = {
  value?: { id?: string; name?: string; hexColor?: string }[];
  "@odata.nextLink"?: string;
};

type GraphEventList = {
  value?: {
    id?: string;
    subject?: string;
    isAllDay?: boolean;
    showAs?: string;
    isCancelled?: boolean;
    start?: { dateTime?: string; timeZone?: string };
    end?: { dateTime?: string; timeZone?: string };
    "@removed"?: unknown;
  }[];
  "@odata.nextLink"?: string;
  "@odata.deltaLink"?: string;
};

function graphMoment(
  slot: { dateTime?: string; timeZone?: string } | undefined,
): Date | null {
  if (!slot?.dateTime) return null;
  // Graph returns a naive local time plus a named zone, and says UTC unless
  // asked otherwise — which this client never does.
  const raw = slot.dateTime.endsWith("Z") ? slot.dateTime : `${slot.dateTime}Z`;
  const at = new Date(raw);
  return Number.isNaN(at.getTime()) ? null : at;
}

const microsoft: CalendarSyncClient = {
  async listCalendars(accessToken) {
    const found: ProviderCalendar[] = [];
    let next: string | undefined = "https://graph.microsoft.com/v1.0/me/calendars?$top=100";
    for (let page = 0; page < MAX_PAGES && next; page += 1) {
      const body: GraphCalendarList = await getJson<GraphCalendarList>(
        next,
        accessToken,
        "Microsoft",
      );
      for (const item of body.value ?? []) {
        if (!item.id) continue;
        found.push({
          externalId: item.id,
          name: item.name ?? item.id,
          colour: item.hexColor && item.hexColor !== "auto" ? item.hexColor : undefined,
        });
      }
      next = body["@odata.nextLink"];
    }
    return found;
  },

  async listEvents(accessToken, input) {
    const events: ProviderEvent[] = [];
    let next: string | undefined;
    if (input.syncToken) {
      next = input.syncToken;
    } else {
      const url = new URL(
        `https://graph.microsoft.com/v1.0/me/calendars/${encodeURIComponent(
          input.externalId,
        )}/calendarView/delta`,
      );
      url.searchParams.set("startDateTime", input.window.startsAt.toISOString());
      url.searchParams.set("endDateTime", input.window.endsAt.toISOString());
      next = url.toString();
    }

    let deltaLink: string | undefined;
    for (let page = 0; page < MAX_PAGES && next; page += 1) {
      let body: GraphEventList;
      try {
        body = await getJson<GraphEventList>(next, accessToken, "Microsoft", {
          prefer: `odata.maxpagesize=${PAGE_SIZE}, outlook.timezone="UTC"`,
        });
      } catch (error) {
        if (input.syncToken && isStaleCursor(error)) {
          return { events: [], resyncRequired: true };
        }
        throw error;
      }
      for (const item of body.value ?? []) {
        if (!item.id) continue;
        if (item["@removed"] !== undefined || item.isCancelled) {
          events.push({
            externalId: item.id,
            startsAt: new Date(0),
            endsAt: new Date(0),
            allDay: false,
            busy: false,
            cancelled: true,
          });
          continue;
        }
        const startsAt = graphMoment(item.start);
        const endsAt = graphMoment(item.end);
        if (!startsAt || !endsAt || endsAt <= startsAt) continue;
        const showAs = (item.showAs ?? "busy").toLowerCase();
        events.push({
          externalId: item.id,
          startsAt,
          endsAt,
          allDay: item.isAllDay === true,
          busy: showAs !== "free" && showAs !== "workingelsewhere",
          title: item.subject,
          cancelled: false,
        });
      }
      deltaLink = body["@odata.deltaLink"] ?? deltaLink;
      next = body["@odata.nextLink"];
    }
    return { events, nextSyncToken: deltaLink, resyncRequired: false };
  },
};

export function calendarSyncClient(provider: OAuthProvider): CalendarSyncClient {
  return provider === "google" ? google : microsoft;
}
