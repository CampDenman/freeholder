// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The busy union (C4.13, MASTER.md §4.4): what the availability engine will be
// allowed to know, and everything it will not.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { users } from "@/core/auth/schema";
import {
  connectedAccounts,
  externalCalendars,
  externalEvents,
} from "@/core/connections/schema";
import { db } from "@/core/db";
import { ready } from "@/core/runtime";
import { busyWindows, calendarSources } from "@/core/connections/busy";
import { closeDb, failure, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

const ACCOUNT = "00000000-0000-4000-8000-0000000000d1";
const DAY = "2026-09-14";

function at(hour: number, minute = 0): Date {
  return new Date(`${DAY}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00.000Z`);
}

async function connect(
  options: { shared?: boolean; id?: string; email?: string } = {},
): Promise<string> {
  const id = options.id ?? ACCOUNT;
  await db()
    .insert(connectedAccounts)
    .values({
      id,
      userId: OWNER.userId,
      provider: "google",
      providerAccountId: `provider-${id}`,
      email: options.email ?? "owner@example.test",
      status: "active",
      sharedWithBusiness: options.shared ?? true,
    });
  return id;
}

async function calendar(
  accountId: string,
  options: { role?: "busy_source" | "bookable" | "ignored"; name?: string } = {},
): Promise<string> {
  const [row] = await db()
    .insert(externalCalendars)
    .values({
      connectedAccountId: accountId,
      externalId: `cal-${options.name ?? "primary"}`,
      name: options.name ?? "Work",
      role: options.role ?? "busy_source",
    })
    .returning({ id: externalCalendars.id });
  return row!.id;
}

async function event(
  calendarId: string,
  startsAt: Date,
  endsAt: Date,
  options: { busy?: boolean; title?: string } = {},
): Promise<void> {
  await db()
    .insert(externalEvents)
    .values({
      externalCalendarId: calendarId,
      externalId: `event-${startsAt.toISOString()}-${calendarId}`,
      startsAt,
      endsAt,
      busy: options.busy ?? true,
      title: options.title ?? null,
    });
}

const WHOLE_DAY = { from: `${DAY}T00:00:00.000Z`, to: `${DAY}T23:59:59.000Z` };

describe.runIf(hasDatabase)("busy union", { timeout: 60_000 }, () => {
  beforeEach(async () => {
    await ready();
    await truncateSpine();
    await db()
      .insert(users)
      .values({ id: OWNER.userId, email: "owner@example.test", role: "owner" });
  }, 60_000);

  afterAll(async () => {
    await truncateSpine();
    await closeDb();
  });

  it("merges overlapping engagements into one period of unavailability", async () => {
    const account = await connect();
    const first = await calendar(account, { name: "Work" });
    const second = await calendar(account, { name: "Studio" });
    await event(first, at(9), at(10, 30));
    await event(second, at(10), at(11));
    // Touching, not overlapping: a gap of zero minutes is not a slot.
    await event(first, at(11), at(12));
    // Genuinely separate.
    await event(second, at(14), at(15));

    const windows = await busyWindows.call(WHOLE_DAY, OWNER);
    expect(windows).toHaveLength(2);
    expect(windows[0]).toMatchObject({ startsAt: at(9), endsAt: at(12) });
    expect(windows[1]).toMatchObject({ startsAt: at(14), endsAt: at(15) });
  });

  it("carries times and nothing else", async () => {
    const account = await connect();
    const source = await calendar(account);
    // An account with detail switched on still hands the resolver times only.
    await event(source, at(9), at(10), { title: "Oncology follow-up" });

    const windows = await busyWindows.call(WHOLE_DAY, OWNER);
    expect(Object.keys(windows[0]!).sort()).toEqual(["endsAt", "startsAt"]);
    expect(JSON.stringify(windows)).not.toContain("Oncology");
  });

  it("leaves a personal account out until it is shared with the business", async () => {
    const account = await connect({ shared: false });
    await event(await calendar(account), at(9), at(10));
    expect(await busyWindows.call(WHOLE_DAY, OWNER)).toEqual([]);

    await db().update(connectedAccounts).set({ sharedWithBusiness: true });
    expect(await busyWindows.call(WHOLE_DAY, OWNER)).toHaveLength(1);
  });

  it("respects a bookable calendar and ignores an ignored one", async () => {
    const account = await connect();
    await event(await calendar(account, { role: "bookable", name: "Clients" }), at(9), at(10));
    await event(await calendar(account, { role: "ignored", name: "Football" }), at(18), at(19));

    const windows = await busyWindows.call(WHOLE_DAY, OWNER);
    // A calendar Freeholder books into is a source of busy time too.
    expect(windows).toHaveLength(1);
    expect(windows[0]?.startsAt).toEqual(at(9));
  });

  it("does not block time an event was marked free for", async () => {
    const account = await connect();
    await event(await calendar(account), at(9), at(10), { busy: false });
    expect(await busyWindows.call(WHOLE_DAY, OWNER)).toEqual([]);
  });

  it("clamps a long engagement to the question that was asked", async () => {
    const account = await connect();
    await event(
      await calendar(account),
      new Date("2026-09-01T00:00:00.000Z"),
      new Date("2026-09-30T00:00:00.000Z"),
    );
    const windows = await busyWindows.call(
      { from: at(9).toISOString(), to: at(17).toISOString() },
      OWNER,
    );
    expect(windows).toEqual([{ startsAt: at(9), endsAt: at(17) }]);
  });

  it("refuses a range that ends before it starts, or reaches too far", async () => {
    expect(
      (await failure(busyWindows.call({ from: WHOLE_DAY.to, to: WHOLE_DAY.from }, OWNER)))
        .code,
    ).toBe("validation");
    expect(
      (
        await failure(
          busyWindows.call(
            { from: "2026-01-01T00:00:00.000Z", to: "2030-01-01T00:00:00.000Z" },
            OWNER,
          ),
        )
      ).code,
    ).toBe("validation");
  });

  it("says which calendars count and, for the rest, why they do not", async () => {
    const shared = await connect({ shared: true });
    const personal = await connect({
      shared: false,
      id: "00000000-0000-4000-8000-0000000000d2",
      email: "personal@example.test",
    });
    await calendar(shared, { name: "Work" });
    await calendar(shared, { role: "ignored", name: "Football" });
    await calendar(personal, { name: "Family" });

    const sources = await calendarSources.call({}, OWNER);
    const byName = new Map(sources.map((source) => [source.name, source]));
    expect(byName.get("Work")?.blocking).toBe(true);
    // The two ways a connected calendar quietly does not block time. Both are
    // listed, because this is the page somebody checks after a double booking.
    expect(byName.get("Football")?.blocking).toBe(false);
    expect(byName.get("Football")?.role).toBe("ignored");
    expect(byName.get("Family")?.blocking).toBe(false);
    expect(byName.get("Family")?.sharedWithBusiness).toBe(false);
  });
});
