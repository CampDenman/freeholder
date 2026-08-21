// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Syncing external calendars (C4.12, MASTER.md §41): busy by default, details
// only when they were asked for, cursors that are allowed to go stale, and a
// dead connection that says so instead of retrying quietly.
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { users } from "@/core/auth/schema";
import {
  connectedAccounts,
  connectionCapabilities,
  externalCalendars,
  externalEvents,
} from "@/core/connections/schema";
import { encryptSecret } from "@/core/connections/crypto";
import { db } from "@/core/db";
import { resetEnvForTests } from "@/core/env";
import { ready } from "@/core/runtime";
import {
  syncCalendars,
  listExternalCalendars,
  setCalendarRole,
  syncDueCalendarAccounts,
} from "@/core/connections/calendar-sync";
import { closeDb, failure, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

const ACCOUNT = "00000000-0000-4000-8000-0000000000c4";

type StubEvent = {
  id: string;
  summary?: string;
  status?: string;
  transparency?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
};

/** A Google that answers with whatever this test decided it holds. */
function googleHolding(options: {
  calendars?: { id: string; summary: string }[];
  events?: StubEvent[];
  nextSyncToken?: string;
  /** Cursors this Google has forgotten, answered with the documented 410. */
  staleTokens?: string[];
}) {
  const seen: string[] = [];
  const fetcher = vi.fn(async (input: string | URL) => {
    const url = new URL(String(input));
    seen.push(url.toString());
    if (url.pathname.endsWith("/users/me/calendarList")) {
      return Response.json({
        items: options.calendars ?? [{ id: "primary", summary: "Work" }],
      });
    }
    const presented = url.searchParams.get("syncToken");
    if (presented && (options.staleTokens ?? []).includes(presented)) {
      return new Response(JSON.stringify({ error: "syncTokenInvalid" }), { status: 410 });
    }
    return Response.json({
      items: options.events ?? [],
      nextSyncToken: options.nextSyncToken ?? "cursor-1",
    });
  });
  return Object.assign(fetcher, { requests: seen });
}

function at(iso: string): { dateTime: string } {
  return { dateTime: iso };
}

/** Somewhere inside the sync window, whenever this test happens to run. */
function soon(hoursFromNow: number): string {
  return new Date(Date.now() + hoursFromNow * 3_600_000).toISOString();
}

async function connectAccount(
  overrides: { detailVisibility?: "busy_only" | "full"; expiresAt?: string } = {},
): Promise<void> {
  await db()
    .insert(connectedAccounts)
    .values({
      id: ACCOUNT,
      userId: OWNER.userId,
      provider: "google",
      providerAccountId: "google-calendar-account",
      email: "owner@example.test",
      credentials: encryptSecret(
        JSON.stringify({
          accessToken: "access-token",
          refreshToken: "refresh-token",
          expiresAt: overrides.expiresAt ?? soon(6),
          tokenType: "Bearer",
        }),
        ACCOUNT,
      ),
      status: "active",
      detailVisibility: overrides.detailVisibility ?? "busy_only",
    });
  await db().insert(connectionCapabilities).values({
    connectedAccountId: ACCOUNT,
    capability: "calendar_read",
    enabled: true,
  });
}

async function storedEvents() {
  return db().select().from(externalEvents);
}

describe.runIf(hasDatabase)("external calendar sync", { timeout: 60_000 }, () => {
  beforeEach(async () => {
    await ready();
    await truncateSpine();
    await db()
      .insert(users)
      .values({ id: OWNER.userId, email: "owner@example.test", role: "owner" });
    process.env.APP_URL = "https://freeholder.example";
    process.env.GOOGLE_OAUTH_CLIENT_ID = "google-client-id";
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = "google-client-secret";
    resetEnvForTests();
  }, 60_000);

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await truncateSpine();
    await closeDb();
  });

  it("stores when somebody is busy and nothing else", async () => {
    await connectAccount();
    vi.stubGlobal(
      "fetch",
      googleHolding({
        events: [
          {
            id: "event-1",
            summary: "Divorce mediation",
            start: at(soon(24)),
            end: at(soon(25)),
          },
        ],
      }),
    );

    const result = await syncCalendars.call({ id: ACCOUNT }, OWNER);
    expect(result).toMatchObject({ calendars: 1, events: 1 });

    const [event] = await storedEvents();
    expect(event).toMatchObject({ busy: true, allDay: false });
    // The whole point of C4.12: availability learns the hour, not the subject.
    expect(event?.title).toBeNull();
    expect(event?.raw).toBeNull();
    expect(JSON.stringify(event)).not.toContain("Divorce");
  });

  it("keeps the title only when the account said details were allowed", async () => {
    await connectAccount({ detailVisibility: "full" });
    vi.stubGlobal(
      "fetch",
      googleHolding({
        events: [
          { id: "event-1", summary: "Site visit", start: at(soon(2)), end: at(soon(3)) },
        ],
      }),
    );
    await syncCalendars.call({ id: ACCOUNT }, OWNER);
    const [event] = await storedEvents();
    expect(event?.title).toBe("Site visit");
  });

  it("records a free event without letting it block anything", async () => {
    await connectAccount();
    vi.stubGlobal(
      "fetch",
      googleHolding({
        events: [
          {
            id: "free-1",
            transparency: "transparent",
            start: at(soon(4)),
            end: at(soon(5)),
          },
        ],
      }),
    );
    await syncCalendars.call({ id: ACCOUNT }, OWNER);
    const [event] = await storedEvents();
    expect(event?.busy).toBe(false);
  });

  it("presents the cursor it was given, and starts again when it is refused", async () => {
    await connectAccount();
    vi.stubGlobal(
      "fetch",
      googleHolding({
        events: [{ id: "event-1", start: at(soon(6)), end: at(soon(7)) }],
        nextSyncToken: "cursor-1",
      }),
    );
    await syncCalendars.call({ id: ACCOUNT }, OWNER);
    const [calendar] = await db().select().from(externalCalendars);
    expect(calendar?.syncToken).toBe("cursor-1");

    // A calendar synced moments ago polls incrementally.
    const second = googleHolding({
      events: [],
      staleTokens: ["cursor-1"],
      nextSyncToken: "cursor-2",
    });
    vi.stubGlobal("fetch", second);
    await syncCalendars.call({ id: ACCOUNT }, OWNER);
    const presented = second.requests.filter((url) => url.includes("syncToken=cursor-1"));
    expect(presented).toHaveLength(1);
    // Refused, so the same run fell back to a windowed pass rather than
    // reporting an empty calendar.
    const full = second.requests.filter((url) => url.includes("timeMin="));
    expect(full.length).toBeGreaterThanOrEqual(1);
    const [after] = await db().select().from(externalCalendars);
    expect(after?.syncToken).toBe("cursor-2");
  });

  it("forgets an event the provider cancelled", async () => {
    await connectAccount();
    vi.stubGlobal(
      "fetch",
      googleHolding({
        events: [{ id: "event-1", start: at(soon(8)), end: at(soon(9)) }],
      }),
    );
    await syncCalendars.call({ id: ACCOUNT }, OWNER);
    expect(await storedEvents()).toHaveLength(1);

    vi.stubGlobal(
      "fetch",
      googleHolding({ events: [{ id: "event-1", status: "cancelled" }] }),
    );
    const result = await syncCalendars.call({ id: ACCOUNT }, OWNER);
    expect(result.removed).toBeGreaterThanOrEqual(1);
    expect(await storedEvents()).toHaveLength(0);
  });

  it("stops reading an ignored calendar and erases what it already read", async () => {
    await connectAccount();
    vi.stubGlobal(
      "fetch",
      googleHolding({
        events: [{ id: "event-1", start: at(soon(10)), end: at(soon(11)) }],
      }),
    );
    await syncCalendars.call({ id: ACCOUNT }, OWNER);
    const [calendar] = await db().select().from(externalCalendars);

    await setCalendarRole.call({ id: calendar!.id, role: "ignored" }, OWNER);
    // Erased, not merely unused: "stop looking" that leaves the last look on
    // file is not what anyone reads it as.
    expect(await storedEvents()).toHaveLength(0);

    const later = googleHolding({
      events: [{ id: "event-2", start: at(soon(12)), end: at(soon(13)) }],
    });
    vi.stubGlobal("fetch", later);
    const result = await syncCalendars.call({ id: ACCOUNT }, OWNER);
    expect(result.events).toBe(0);
    expect(later.requests.some((url) => url.includes("/events"))).toBe(false);
    // Rediscovery must not quietly undo the owner's decision.
    const [again] = await db().select().from(externalCalendars);
    expect(again?.role).toBe("ignored");
  });

  it("refuses when calendar reading is switched off for the connection", async () => {
    await connectAccount();
    await db()
      .update(connectionCapabilities)
      .set({ enabled: false })
      .where(eq(connectionCapabilities.connectedAccountId, ACCOUNT));
    const refused = await failure(syncCalendars.call({ id: ACCOUNT }, OWNER));
    expect(refused.code).toBe("conflict");
    expect(refused.message).toContain("switched off");
  });

  it("asks for a reconnection instead of retrying a revoked grant", async () => {
    await connectAccount({ expiresAt: "2000-01-01T00:00:00.000Z" });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 }),
      ),
    );

    const swept = await syncDueCalendarAccounts();
    expect(swept).toMatchObject({ synced: 0, failed: 1 });
    const [account] = await db()
      .select()
      .from(connectedAccounts)
      .where(eq(connectedAccounts.id, ACCOUNT));
    expect(account?.status).toBe("needs_reconnect");
    expect(account?.lastError).toContain("Reconnect");
  });

  it("lists what it found, with the owner's role for each calendar", async () => {
    await connectAccount();
    vi.stubGlobal(
      "fetch",
      googleHolding({
        calendars: [
          { id: "primary", summary: "Work" },
          { id: "football", summary: "Five-a-side" },
        ],
        events: [{ id: "event-1", start: at(soon(14)), end: at(soon(15)) }],
      }),
    );
    await syncCalendars.call({ id: ACCOUNT }, OWNER);

    const listed = await listExternalCalendars.call({ id: ACCOUNT }, OWNER);
    expect(listed).toHaveLength(2);
    expect(listed.map((row) => row.name).sort()).toEqual(["Five-a-side", "Work"]);
    expect(listed.every((row) => row.role === "busy_source")).toBe(true);
    expect(listed.reduce((total, row) => total + row.events, 0)).toBe(2);
  });
});
