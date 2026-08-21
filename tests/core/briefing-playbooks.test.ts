// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// "Report into my briefing" and getting the briefing out of the admin
// (C4.17, MASTER.md §42).
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { users } from "@/core/auth/schema";
import { agents, agentConnections, agentPlaybooks, agentTasks } from "@/core/agents/schema";
import { notifications } from "@/core/notifications/schema";
import { db } from "@/core/db";
import { ready } from "@/core/runtime";
import { createPlaybook, runPlaybook } from "@/core/agents/playbooks";
import { assembleBriefing, readBriefing } from "@/core/briefing/service";
import { briefingContributors } from "@/core/briefing/registry";
import { closeDb, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

const SYSTEM = { kind: "system" } as const;

describe.runIf(hasDatabase)("playbooks in the briefing", { timeout: 60_000 }, () => {
  beforeEach(async () => {
    await ready();
    await truncateSpine();
    await db()
      .insert(users)
      .values({ id: OWNER.userId, email: "owner@example.test", role: "owner" })
      .onConflictDoNothing();
  }, 60_000);

  afterAll(closeDb);

  /** A playbook that has run once and left an answer behind. */
  async function reported(
    result: unknown,
    options: { status?: "done" | "failed"; reportsToBriefing?: boolean } = {},
  ): Promise<{ playbookId: string; taskId: string }> {
    const [connection] = await db()
      .insert(agentConnections)
      .values({ name: "Local worker", kind: "inbound", createdBy: OWNER.userId })
      .returning({ id: agentConnections.id });
    const [agent] = await db()
      .insert(agents)
      .values({
        name: "Morning triager",
        role: "Read the inbox.",
        connectionId: connection!.id,
      })
      .returning({ id: agents.id });

    const playbook = await createPlaybook.call(
      {
        name: "Morning triage",
        briefTemplate: "Tell me which enquiries need a reply today.",
        defaultAgentId: agent!.id,
        reportsToBriefing: options.reportsToBriefing ?? true,
      },
      OWNER,
    );
    const started = await runPlaybook.call({ id: playbook.id }, OWNER);
    await db()
      .update(agentTasks)
      .set({ status: options.status ?? "done", result: result })
      .where(eq(agentTasks.id, started.taskId));
    return { playbookId: playbook.id, taskId: started.taskId };
  }

  // Today, whenever "today" is: a playbook section reports what ran since
  // yesterday morning, so a fixed date in the future would find nothing.
  async function assemble() {
    return assembleBriefing.call({ userId: OWNER.userId }, SYSTEM);
  }

  async function read() {
    return readBriefing.call({}, OWNER);
  }

  it("registers one section per playbook that was told to report", async () => {
    const { playbookId } = await reported({ summary: "Two enquiries need a reply." });
    const registered = await briefingContributors();
    const mine = registered.find((entry) => entry.key === `playbook:${playbookId}`);
    // Keyed per playbook, so hiding one does not hide the others.
    expect(mine).toMatchObject({
      service: "briefing.playbookSection",
      source: "playbook",
      params: { playbookId },
    });
    // Below core and the modules: what an owner asked an agent to look into is
    // rarely more urgent than the platform saying it is broken.
    const lastCore = Math.max(
      ...registered.flatMap((entry, index) => (entry.source === "core" ? [index] : [])),
    );
    expect(registered.indexOf(mine!)).toBeGreaterThan(lastCore);
  });

  it("reports the agent's own words, not a paraphrase of them", async () => {
    await reported({ summary: "Two enquiries need a reply today; one sounds unhappy." });
    await assemble();
    const briefing = await read();
    const section = briefing?.sections.find((entry) => entry.source === "playbook");
    expect(section?.title).toBe("Morning triage");
    expect(section?.body).toBe(
      "Two enquiries need a reply today; one sounds unhappy.",
    );
    expect(section?.items[0]?.href).toContain("/admin/work/tasks/");
  });

  it("says so when the work did not finish", async () => {
    // A playbook the owner asked to report is one whose silence reads as
    // "nothing to report", so a failure has to speak for itself.
    await reported(null, { status: "failed" });
    await db().update(agentTasks).set({ failureReason: "The provider refused." });
    await assemble();
    const briefing = await read();
    const section = briefing?.sections.find((entry) => entry.source === "playbook");
    expect(section).toMatchObject({ severity: "attention" });
    expect(section?.body).toContain("The provider refused.");
  });

  it("stays out of the briefing until it is asked in", async () => {
    await reported({ summary: "Something happened." }, { reportsToBriefing: false });
    const registered = await briefingContributors();
    expect(registered.some((entry) => entry.source === "playbook")).toBe(false);
    await assemble();
    const briefing = await read();
    expect(briefing?.sections.some((entry) => entry.source === "playbook")).toBe(false);
  });

  it("shows nothing rather than rendering an object at somebody", async () => {
    await reported({ tokensUsed: 412, ok: true });
    await assemble();
    const briefing = await read();
    expect(briefing?.sections.some((entry) => entry.source === "playbook")).toBe(false);
  });

  it("switches off with the playbook itself", async () => {
    const { playbookId } = await reported({ summary: "Something happened." });
    await db()
      .update(agentPlaybooks)
      .set({ enabled: false })
      .where(eq(agentPlaybooks.id, playbookId));
    const registered = await briefingContributors();
    expect(registered.some((entry) => entry.source === "playbook")).toBe(false);
  });

  it("sends the briefing out through the person's usual notifications", async () => {
    await reported({ summary: "Two enquiries need a reply." });
    await assemble();

    // §42: a business owner who does not open the admin until Thursday still
    // needs to know about Monday. It goes down the ordinary path, so the
    // channels are the person's existing preferences rather than a second set
    // of settings to keep in step.
    const [sent] = await db()
      .select()
      .from(notifications)
      .where(eq(notifications.recipientUserId, OWNER.userId));
    expect(sent).toMatchObject({ topic: "briefing.ready", href: "/admin/briefing" });

    // Re-assembling the day must not buzz the same phone twice.
    await assemble();
    const all = await db()
      .select()
      .from(notifications)
      .where(eq(notifications.recipientUserId, OWNER.userId));
    expect(all).toHaveLength(1);
  });

  it("does not buzz anybody about a briefing with nothing in it", async () => {
    await assemble();
    expect(await db().select().from(notifications)).toHaveLength(0);
  });
});
