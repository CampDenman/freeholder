// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Scheduled playbooks (C4.14, MASTER.md §40). The interesting cases are all
// failure modes of schedulers: the stampede after an outage, the pile-up when
// a run is slow, and the hour that moves twice a year.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { users } from "@/core/auth/schema";
import { agentPlaybooks, agentTasks } from "@/core/agents/schema";
import { db } from "@/core/db";
import { ready } from "@/core/runtime";
import { createPlaybook } from "@/core/agents/playbooks";
import { nextOccurrence } from "@/core/agents/cron";
import {
  runDuePlaybooks,
  setPlaybookSchedule,
} from "@/core/agents/playbook-schedule";
import { closeDb, failure, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

const SYSTEM = { kind: "system" } as const;

describe("cron in a named zone", () => {
  it("keeps a morning schedule in the morning across a clock change", () => {
    const before = nextOccurrence("0 7 * * *", "America/New_York", new Date("2026-03-06T12:00:00Z"));
    const after = nextOccurrence("0 7 * * *", "America/New_York", new Date("2026-03-10T12:00:00Z"));
    // 12:00Z in winter, 11:00Z in summer — the same 07:00 to the person who
    // wrote it, which is the whole point of storing a zone.
    expect(before.toISOString()).toBe("2026-03-07T12:00:00.000Z");
    expect(after.toISOString()).toBe("2026-03-11T11:00:00.000Z");
  });

  it("always moves forward, never returns the moment it was given", () => {
    const at = new Date("2026-05-04T09:00:00.000Z");
    expect(nextOccurrence("0 9 * * *", "UTC", at).getTime()).toBeGreaterThan(at.getTime());
  });
});

describe.runIf(hasDatabase)("scheduled playbooks", { timeout: 60_000 }, () => {
  beforeEach(async () => {
    await ready();
    await truncateSpine();
    await db()
      .insert(users)
      .values({ id: OWNER.userId, email: "owner@example.test", role: "owner" })
      .onConflictDoNothing();
  }, 60_000);

  afterAll(closeDb);

  async function scheduled(cron = "*/5 * * * *"): Promise<string> {
    const playbook = await createPlaybook.call(
      {
        name: `Morning triage ${cron}`,
        description: "Look at what came in overnight.",
        briefTemplate: "Tell me which enquiries need a reply today.",
      },
      OWNER,
    );
    await setPlaybookSchedule.call({ id: playbook.id, cron }, OWNER);
    return playbook.id;
  }

  /** Make a schedule due, as though its window had just come round. */
  async function due(id: string, minutesAgo = 0): Promise<void> {
    await db()
      .update(agentPlaybooks)
      .set({ nextRunAt: new Date(Date.now() - minutesAgo * 60_000) })
      .where(eq(agentPlaybooks.id, id));
  }

  async function tasksFor(id: string) {
    const rows = await db().select().from(agentTasks);
    return rows.filter((task) => task.sourceRef?.startsWith(`playbook:${id}@`));
  }

  it("turns a schedule into work and moves the next run forward", async () => {
    const id = await scheduled();
    await due(id);
    expect(await runDuePlaybooks.call({}, SYSTEM)).toMatchObject({ started: 1 });

    const [playbook] = await db()
      .select()
      .from(agentPlaybooks)
      .where(eq(agentPlaybooks.id, id));
    expect(playbook?.lastRunAt).not.toBeNull();
    expect(playbook!.nextRunAt!.getTime()).toBeGreaterThan(Date.now());

    const tasks = await tasksFor(id);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ source: "schedule", inputTrust: "owner" });
    // Nothing is due any more, so a second tick this minute does nothing.
    expect(await runDuePlaybooks.call({}, SYSTEM)).toMatchObject({ started: 0 });
  });

  it("comes back from an outage with one overdue run, not hundreds", async () => {
    // Every five minutes, and the instance was down for six hours.
    const id = await scheduled("*/5 * * * *");
    await db()
      .update(agentPlaybooks)
      .set({ catchUp: true, nextRunAt: new Date(Date.now() - 6 * 3_600_000) })
      .where(eq(agentPlaybooks.id, id));

    const first = await runDuePlaybooks.call({}, SYSTEM);
    expect(first).toMatchObject({ started: 1 });
    // The classic failure is 72 tasks. The schedule is advanced past *now*,
    // so the backlog is one run and the rest of the outage is simply over.
    expect(await tasksFor(id)).toHaveLength(1);
    expect(await runDuePlaybooks.call({}, SYSTEM)).toMatchObject({ started: 0 });
  });

  it("skips a window it slept through when catch-up is off", async () => {
    const id = await scheduled();
    await due(id, 90);
    const result = await runDuePlaybooks.call({}, SYSTEM);
    expect(result).toMatchObject({ started: 0, missed: 1 });
    expect(await tasksFor(id)).toHaveLength(0);

    const [playbook] = await db()
      .select()
      .from(agentPlaybooks)
      .where(eq(agentPlaybooks.id, id));
    // A briefing delivered seven hours late is not a briefing, and the owner
    // is told that is what happened rather than left wondering.
    expect(playbook?.lastOutcome).toContain("catch-up is off");
    expect(playbook!.nextRunAt!.getTime()).toBeGreaterThan(Date.now());
  });

  it("refuses to start a second run while the first is still going", async () => {
    const id = await scheduled();
    await due(id);
    await runDuePlaybooks.call({}, SYSTEM);
    expect(await tasksFor(id)).toHaveLength(1);

    await due(id);
    const second = await runDuePlaybooks.call({}, SYSTEM);
    expect(second).toMatchObject({ started: 0, skipped: 1 });
    expect(await tasksFor(id)).toHaveLength(1);

    const [playbook] = await db()
      .select()
      .from(agentPlaybooks)
      .where(eq(agentPlaybooks.id, id));
    expect(playbook?.lastOutcome).toContain("Still running from");
    // And the schedule still advanced: a refused window that stayed due would
    // be retried every minute for as long as the run took.
    expect(playbook!.nextRunAt!.getTime()).toBeGreaterThan(Date.now());
  });

  it("starts again once the previous run is finished", async () => {
    const id = await scheduled();
    await due(id);
    await runDuePlaybooks.call({}, SYSTEM);
    await db().update(agentTasks).set({ status: "done" });

    await due(id);
    expect(await runDuePlaybooks.call({}, SYSTEM)).toMatchObject({ started: 1 });
    expect(await tasksFor(id)).toHaveLength(2);
  });

  it("leaves a switched-off playbook alone", async () => {
    const id = await scheduled();
    await db().update(agentPlaybooks).set({ enabled: false }).where(eq(agentPlaybooks.id, id));
    await due(id);
    expect(await runDuePlaybooks.call({}, SYSTEM)).toMatchObject({ started: 0 });
    expect(await tasksFor(id)).toHaveLength(0);
  });

  it("refuses a schedule or a zone it cannot read, before anything is stored", async () => {
    const playbook = await createPlaybook.call(
      { name: "Unschedulable", briefTemplate: "Do the thing." },
      OWNER,
    );
    const badCron = await failure(
      setPlaybookSchedule.call({ id: playbook.id, cron: "every monday" }, OWNER),
    );
    expect(badCron.code).toBe("validation");
    const badZone = await failure(
      setPlaybookSchedule.call(
        { id: playbook.id, cron: "0 9 * * *", timezone: "Mars/Olympus" },
        OWNER,
      ),
    );
    expect(badZone.code).toBe("validation");

    const [stored] = await db()
      .select()
      .from(agentPlaybooks)
      .where(eq(agentPlaybooks.id, playbook.id));
    expect(stored?.trigger).toBe("manual");
    expect(stored?.nextRunAt).toBeNull();
  });

  it("gives a playbook created as scheduled a first run to count down to", async () => {
    // Without this the playbook is enabled, says "every weekday at seven",
    // and never fires — a failure nobody can see from the screen.
    const playbook = await createPlaybook.call(
      {
        name: "Weekly review",
        briefTemplate: "Summarise the week.",
        trigger: "schedule",
        scheduleCron: "0 9 * * 1",
      },
      OWNER,
    );
    const [stored] = await db()
      .select()
      .from(agentPlaybooks)
      .where(eq(agentPlaybooks.id, playbook.id));
    expect(stored?.nextRunAt).not.toBeNull();
    expect(stored!.nextRunAt!.getTime()).toBeGreaterThan(Date.now());
  });

  it("refuses a cron it cannot read at the moment it is written", async () => {
    const refused = await failure(
      createPlaybook.call(
        {
          name: "Nonsense",
          briefTemplate: "Do the thing.",
          trigger: "schedule",
          scheduleCron: "0 99 * * *",
        },
        OWNER,
      ),
    );
    expect(refused.code).toBe("validation");
  });

  it("is the scheduler's to call, not an agent's or a visitor's", async () => {
    expect((await failure(runDuePlaybooks.call({}, OWNER))).code).toBe("permission");
  });
});
