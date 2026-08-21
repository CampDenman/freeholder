// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// What core and the modules put in the briefing (C4.16, MASTER.md §42).
//
// The sections worth testing hardest are the ones about the platform being
// unhappy: an agent waiting, a webhook paused, a connection dead. Each of
// those states is deliberately silent everywhere else, so a bug here is a
// failure nobody ever hears about.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { users } from "@/core/auth/schema";
import { agents, agentConnections, agentTasks } from "@/core/agents/schema";
import {
  connectedAccounts,
  externalCalendars,
  externalEvents,
} from "@/core/connections/schema";
import { webhookSubscriptions } from "@/core/webhooks/schema";
import { db } from "@/core/db";
import { ready } from "@/core/runtime";
import {
  agentAttention,
  appointmentsToday,
  connectionsNeedingAttention,
  updateAvailable,
  webhookFailures,
} from "@/core/briefing/contributors";
import { closeDb, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

const SYSTEM = { kind: "system" } as const;
const ASK = {
  userId: OWNER.userId,
  onDate: "2026-09-14",
  timezone: "Europe/London",
};

const ACCOUNT = "00000000-0000-4000-8000-0000000000f1";

describe.runIf(hasDatabase)("core briefing contributors", { timeout: 60_000 }, () => {
  beforeEach(async () => {
    await ready();
    await truncateSpine();
    await db()
      .insert(users)
      .values({ id: OWNER.userId, email: "owner@example.test", role: "owner" })
      .onConflictDoNothing();
  }, 60_000);

  afterAll(closeDb);

  async function connect(shared = true): Promise<string> {
    await db().insert(connectedAccounts).values({
      id: ACCOUNT,
      userId: OWNER.userId,
      provider: "google",
      providerAccountId: "briefing-account",
      email: "owner@example.test",
      status: "active",
      sharedWithBusiness: shared,
    });
    const [calendar] = await db()
      .insert(externalCalendars)
      .values({ connectedAccountId: ACCOUNT, externalId: "primary", name: "Work" })
      .returning({ id: externalCalendars.id });
    return calendar!.id;
  }

  it("lists today's appointments and no more of them than it should", async () => {
    const calendar = await connect();
    await db().insert(externalEvents).values([
      {
        externalCalendarId: calendar,
        externalId: "today",
        startsAt: new Date("2026-09-14T09:00:00.000Z"),
        endsAt: new Date("2026-09-14T10:00:00.000Z"),
        busy: true,
        title: "Site visit",
      },
      {
        externalCalendarId: calendar,
        externalId: "tomorrow",
        startsAt: new Date("2026-09-15T09:00:00.000Z"),
        endsAt: new Date("2026-09-15T10:00:00.000Z"),
        busy: true,
      },
    ]);

    const section = await appointmentsToday.call(ASK, SYSTEM);
    expect(section).toMatchObject({ severity: "today" });
    expect(section?.items).toHaveLength(1);
    expect(section?.items[0]).toMatchObject({
      label: "Site visit",
      detail: "10:00–11:00",
    });
  });

  it("says busy rather than inventing a title the account did not permit", async () => {
    // C4.12 stores no title unless the account allows detail. The briefing is
    // not a way around that setting.
    const calendar = await connect();
    await db().insert(externalEvents).values({
      externalCalendarId: calendar,
      externalId: "private",
      startsAt: new Date("2026-09-14T14:00:00.000Z"),
      endsAt: new Date("2026-09-14T15:00:00.000Z"),
      busy: true,
    });
    const section = await appointmentsToday.call(ASK, SYSTEM);
    expect(section?.items[0]?.label).toBe("Busy");
  });

  it("leaves a personal calendar out of the business's day", async () => {
    const calendar = await connect(false);
    await db().insert(externalEvents).values({
      externalCalendarId: calendar,
      externalId: "personal",
      startsAt: new Date("2026-09-14T09:00:00.000Z"),
      endsAt: new Date("2026-09-14T10:00:00.000Z"),
      busy: true,
    });
    expect(await appointmentsToday.call(ASK, SYSTEM)).toBeNull();
  });

  it("surfaces work that stopped and is waiting for a person", async () => {
    const [connection] = await db()
      .insert(agentConnections)
      .values({ name: "Local worker", kind: "inbound", createdBy: OWNER.userId })
      .returning({ id: agentConnections.id });
    const [agent] = await db()
      .insert(agents)
      .values({ name: "Inbox triager", role: "Triage the inbox.", connectionId: connection!.id })
      .returning({ id: agents.id });
    // Created through the service, so the rows look exactly like real work
    // rather than like something a test assembled by hand.
    const { createTask } = await import("@/core/agents/service");
    for (const [title, status] of [
      ["Chase overdue", "waiting_approval"],
      ["Draft reply", "failed"],
      ["Quiet one", "done"],
    ] as const) {
      const task = await createTask.call(
        { title, brief: `${title}.`, agentId: agent!.id },
        OWNER,
      );
      await db().update(agentTasks).set({ status }).where(eq(agentTasks.id, task.id));
    }

    const section = await agentAttention.call(ASK, SYSTEM);
    // Waiting is correct behaviour and completely silent; without this section
    // §40's safety ceiling reads as the work never happening.
    expect(section).toMatchObject({ severity: "attention" });
    expect(section?.items).toHaveLength(2);
    expect(section?.body).toContain("1 of these");
    expect(section?.items.find((item) => item.detail === "Waiting for approval")?.href).toBe(
      "/admin/work/approvals",
    );
  });

  it("names a webhook that paused itself, by host and not by full URL", async () => {
    await db().insert(webhookSubscriptions).values({
      name: "Order feed",
      url: "https://hooks.example.test/inbound?token=secret-token",
      events: ["order.paid"],
      secret: "shh",
      status: "paused",
      pausedReason: "Twelve failures in a row.",
    });
    const section = await webhookFailures.call(ASK, SYSTEM);
    expect(section?.items[0]?.label).toBe("hooks.example.test");
    // A briefing is read over somebody's shoulder; a signed callback URL is
    // not summary material.
    expect(JSON.stringify(section)).not.toContain("secret-token");
    expect(section?.items[0]?.detail).toBe("Twelve failures in a row.");
  });

  it("names a connection that needs reconnecting, in the provider's words", async () => {
    await connect();
    await db()
      .update(connectedAccounts)
      .set({
        status: "needs_reconnect",
        lastError: "The provider revoked or expired this authorization.",
      });
    const section = await connectionsNeedingAttention.call(ASK, SYSTEM);
    expect(section).toMatchObject({ severity: "attention" });
    expect(section?.items[0]?.detail).toContain("revoked");
  });

  it("says nothing at all when the platform is happy", async () => {
    // The quiet-day case, and the one that decides whether the briefing is
    // worth opening: no padding, no empty headings.
    expect(await agentAttention.call(ASK, SYSTEM)).toBeNull();
    expect(await webhookFailures.call(ASK, SYSTEM)).toBeNull();
    expect(await connectionsNeedingAttention.call(ASK, SYSTEM)).toBeNull();
    expect(await appointmentsToday.call(ASK, SYSTEM)).toBeNull();
    // No update check exists yet (C10.04), and "none known" is the same answer
    // an instance running the newest release gives.
    expect(await updateAvailable.call(ASK, SYSTEM)).toBeNull();
  });
});
