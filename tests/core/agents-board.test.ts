// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Work board, tree, assignment, due/priority and needs-attention (C4.01).
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/core/db";
import { users } from "@/core/auth/schema";
import {
  boardColumn,
  connectAgentRuntime,
  createTask,
  flagTask,
  hireAgent,
  listBoard,
  listTasks,
  reopenTask,
  updateTask,
} from "@/core/agents/service";
import { closeDb, failure, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

describe("board columns (C4.01)", () => {
  it("maps parked and failed work onto needs-attention", () => {
    expect(boardColumn("queued")).toBe("queued");
    expect(boardColumn("waiting_approval")).toBe("waiting_approval");
    expect(boardColumn("failed")).toBe("needs_attention");
    expect(boardColumn("blocked")).toBe("needs_attention");
    expect(boardColumn("cancelled")).toBeNull();
  });
});

describe.runIf(hasDatabase)("the work board", { timeout: 30_000 }, () => {
  let agentId: string;

  beforeEach(async () => {
    await truncateSpine();
    await db()
      .insert(users)
      .values({ id: OWNER.userId, email: "owner@example.test", role: "owner" })
      .onConflictDoNothing();
    const link = await connectAgentRuntime.call(
      { name: "My Claude", kind: "inbound", maxConcurrency: 2 },
      OWNER,
    );
    agentId = (
      await hireAgent.call(
        { connectionId: link.id, name: "Inbox triager", role: "triages" },
        OWNER,
      )
    ).id;
  });
  afterAll(closeDb);

  it("groups work into the five owner-facing columns", async () => {
    const queued = await createTask.call({ title: "Queued" }, OWNER);
    const attention = await createTask.call({ title: "Stuck" }, OWNER);
    await flagTask.call({ id: attention.id, reason: "Needs a person." }, OWNER);
    const columns = await listBoard.call({}, OWNER);
    expect(columns.map((column) => column.column)).toEqual([
      "queued",
      "running",
      "waiting_approval",
      "needs_attention",
      "done",
    ]);
    expect(columns.find((column) => column.column === "queued")?.tasks.map((task) => task.id)).toContain(
      queued.id,
    );
    expect(
      columns.find((column) => column.column === "needs_attention")?.tasks.map((task) => task.id),
    ).toContain(attention.id);
  });

  it("filters unassigned work and due dates", async () => {
    await createTask.call({ title: "Mine", agentId }, OWNER);
    const open = await createTask.call(
      { title: "Soon", dueAt: "2026-08-20T12:00:00.000Z" },
      OWNER,
    );
    expect(await listTasks.call({ unassigned: true }, OWNER)).toHaveLength(1);
    const due = await listTasks.call({ dueBefore: "2026-08-21T00:00:00.000Z" }, OWNER);
    expect(due.map((task) => task.id)).toEqual([open.id]);
  });

  it("changes priority and due date", async () => {
    const task = await createTask.call({ title: "Work", priority: 2 }, OWNER);
    const updated = await updateTask.call(
      { id: task.id, priority: 5, dueAt: "2026-09-01T09:00:00.000Z" },
      OWNER,
    );
    expect(updated.priority).toBe(5);
    expect(updated.dueAt?.toISOString()).toBe("2026-09-01T09:00:00.000Z");
  });

  it("reopens flagged work, or parks it as blocked when a dependency is open", async () => {
    const first = await createTask.call({ title: "First" }, OWNER);
    const second = await createTask.call({ title: "Second", dependsOn: [first.id] }, OWNER);
    await flagTask.call({ id: second.id, reason: "Waiting on a person." }, OWNER);
    expect((await reopenTask.call({ id: second.id }, OWNER)).status).toBe("blocked");
    const lone = await createTask.call({ title: "Lone" }, OWNER);
    await flagTask.call({ id: lone.id, reason: "Check this." }, OWNER);
    expect((await reopenTask.call({ id: lone.id }, OWNER)).status).toBe("queued");
  });

  it("refuses to flag finished work", async () => {
    const { cancelTask } = await import("@/core/agents/service");
    const task = await createTask.call({ title: "Work" }, OWNER);
    await cancelTask.call({ id: task.id }, OWNER);
    expect((await failure(flagTask.call({ id: task.id, reason: "x" }, OWNER))).code).toBe(
      "conflict",
    );
  });
});
