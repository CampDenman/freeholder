// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Writing one booking to a connected calendar (MASTER.md §41, C6.06).
//
// Deliberately not routed through the `CalendarAdapter` family in
// `src/adapters/calendar`. That contract describes a single configured
// provider and takes a bare `calendarRef`; it has nowhere to say *whose*
// credentials to use. A booking is written to the account the busy time is
// already read from — same connection, same token, same refresh path, same
// revocation — and inventing a second way to reach the same provider would be
// two things to keep in step and two things to get revoked.
//
// The scope of what is written is §41's line, held exactly: Freeholder writes
// the bookings it made. It creates, updates and cancels those events and
// touches nothing else on the calendar.
import { and, eq } from "drizzle-orm";
import { requestWithTimeout, providerJson } from "@/adapters/mail/http";
import { accessTokenForAccount } from "@/core/connections/oauth-core";
import {
  connectedAccounts,
  connectionCapabilities,
  externalCalendars,
} from "@/core/connections/schema";
import { ServiceError, type Tx } from "@/core/service";

export interface WritableEvent {
  /** The upstream id, when updating one this instance already created. */
  providerRef?: string | null;
  summary: string;
  startsAt: Date;
  endsAt: Date;
  timezone: string;
  description?: string;
}

interface Target {
  provider: "google" | "microsoft";
  accountId: string;
  calendarExternalId: string;
}

/**
 * The account and calendar a Freeholder calendar writes to, if any.
 *
 * Returns null rather than throwing for every ordinary reason not to write —
 * no link, no account, writing not switched on. A booking whose calendar has
 * no upstream is not an error; it is the normal state of an instance nobody
 * connected anything to.
 */
export async function writeTargetFor(
  tx: Tx,
  externalCalendarId: string | null,
): Promise<Target | null> {
  if (!externalCalendarId) return null;
  const [found] = await tx
    .select({
      accountId: connectedAccounts.id,
      provider: connectedAccounts.provider,
      status: connectedAccounts.status,
      calendarExternalId: externalCalendars.externalId,
      role: externalCalendars.role,
    })
    .from(externalCalendars)
    .innerJoin(
      connectedAccounts,
      eq(connectedAccounts.id, externalCalendars.connectedAccountId),
    )
    .where(eq(externalCalendars.id, externalCalendarId))
    .limit(1);
  if (!found) return null;
  if (found.provider !== "google" && found.provider !== "microsoft") return null;
  if (found.status !== "active") return null;
  // §41 splits reading from writing on purpose. A calendar marked as a busy
  // source is one Freeholder reads; only a `bookable` one is written to.
  if (found.role !== "bookable") return null;

  const [mayWrite] = await tx
    .select({ id: connectionCapabilities.id })
    .from(connectionCapabilities)
    .where(
      and(
        eq(connectionCapabilities.connectedAccountId, found.accountId),
        eq(connectionCapabilities.capability, "calendar_write"),
        eq(connectionCapabilities.enabled, true),
      ),
    )
    .limit(1);
  // Writing needs the capability the owner switched on, not merely the scope
  // the provider granted (§41: the provider says what it permitted, the owner
  // says what is switched on).
  if (!mayWrite) return null;

  return {
    provider: found.provider,
    accountId: found.accountId,
    calendarExternalId: found.calendarExternalId,
  };
}

async function send<T>(
  url: string,
  accessToken: string,
  init: { method: string; body?: unknown },
  label: string,
): Promise<T> {
  const response = await requestWithTimeout(globalThis.fetch, url, {
    method: init.method,
    headers: {
      authorization: `Bearer ${accessToken}`,
      accept: "application/json",
      "content-type": "application/json",
    },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
  // A delete answers 204 with no body, which `providerJson` reads as {}.
  return providerJson<T>(response, label);
}

/** Create or update the event, returning the id to remember it by. */
export async function writeEvent(
  tx: Tx,
  target: Target,
  event: WritableEvent,
): Promise<string> {
  const accessToken = await accessTokenForAccount(tx, {
    id: target.accountId,
    provider: target.provider,
  });

  if (target.provider === "google") {
    const base = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(
      target.calendarExternalId,
    )}/events`;
    const body = {
      summary: event.summary,
      description: event.description,
      start: { dateTime: event.startsAt.toISOString(), timeZone: event.timezone },
      end: { dateTime: event.endsAt.toISOString(), timeZone: event.timezone },
    };
    const written = await send<{ id?: string }>(
      event.providerRef ? `${base}/${encodeURIComponent(event.providerRef)}` : base,
      accessToken,
      { method: event.providerRef ? "PATCH" : "POST", body },
      "Google",
    );
    if (!written.id) {
      throw new ServiceError("conflict", "Google did not return the event it created.");
    }
    return written.id;
  }

  const base = `https://graph.microsoft.com/v1.0/me/calendars/${encodeURIComponent(
    target.calendarExternalId,
  )}/events`;
  const body = {
    subject: event.summary,
    body: event.description
      ? { contentType: "text", content: event.description }
      : undefined,
    start: { dateTime: event.startsAt.toISOString(), timeZone: "UTC" },
    end: { dateTime: event.endsAt.toISOString(), timeZone: "UTC" },
  };
  const written = await send<{ id?: string }>(
    event.providerRef
      ? `https://graph.microsoft.com/v1.0/me/events/${encodeURIComponent(event.providerRef)}`
      : base,
    accessToken,
    { method: event.providerRef ? "PATCH" : "POST", body },
    "Microsoft",
  );
  if (!written.id) {
    throw new ServiceError("conflict", "Microsoft did not return the event it created.");
  }
  return written.id;
}

/** Remove an event this instance created. */
export async function deleteEvent(
  tx: Tx,
  target: Target,
  providerRef: string,
): Promise<void> {
  const accessToken = await accessTokenForAccount(tx, {
    id: target.accountId,
    provider: target.provider,
  });
  const url =
    target.provider === "google"
      ? `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(
          target.calendarExternalId,
        )}/events/${encodeURIComponent(providerRef)}`
      : `https://graph.microsoft.com/v1.0/me/events/${encodeURIComponent(providerRef)}`;
  await send(url, accessToken, { method: "DELETE" }, target.provider === "google" ? "Google" : "Microsoft");
}
