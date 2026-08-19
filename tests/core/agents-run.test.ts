// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Live run inspection, redaction, stop and retry (C4.02).
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { users } from "@/core/auth/schema";
import { agentRuns, agentSteps, agentTasks } from "@/core/agents/schema";
import {
  cancelTask,
  connectAgentRuntime,
  createTask,
  getTask,
  hireAgent,
  inspectRun,
  retryTask,
  stopRun,
  tailRun,
} from "@/core/agents/service";
import { claimTask, completeTask, reportStep } from "@/core/agents/execution";
import type { Actor } from "@/core/service";
import { closeDb, failure, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

function asAgent(name: string): Actor {
  return { kind: "agent", keyName: `agent:${name}`, scopes: ["agents.*"] };
}

async function hire(name: string) {
  const link = await connectAgentRuntime.call(
    { name: `runtime-${name}`, kind: "inbound" },
    OWNER,
  );
  return hireAgent.call({ connectionId: link.id, name, role: "worker" }, OWNER);
}

describe.runIf(hasDatabase)("live run inspection (C4.02)", { timeout: 30_000 }, () => {
  beforeEach(async () => {
    await truncateSpine();
    await db()
      .insert(users)
      .values({ id: OWNER.userId, email: "owner@example.test", role: "owner" })
      .onConflictDoNothing();
  });
  afterAll(closeDb);

  it("redacts secrets on write and on inspect", async () => {
    await hire("Worker");
    await createTask.call({ title: "Work" }, OWNER);
    const claim = await claimTask.call({}, asAgent("Worker"));
    await reportStep.call(
      {
        runId: claim!.runId,
        kind: "tool_call",
        serviceName: "contacts.list",
        input: { token: "super-secret", email: "rae@example.test" },
      },
      asAgent("Worker"),
    );
    const [stored] = await db().select().from(agentSteps);
    expect(stored?.input).toMatchObject({ token: "[redacted]", email: "rae@example.test" });
    const inspected = await inspectRun.call({ runId: claim!.runId }, OWNER);
    expect(inspected?.steps[0]?.input).toMatchObject({ token: "[redacted]" });
    const tailed = await tailRun.call({ runId: claim!.runId, afterSeq: 0 }, OWNER);
    expect(tailed?.live).toBe(true);
    expect(tailed?.steps).toHaveLength(1);
    const later = await tailRun.call({ runId: claim!.runId, afterSeq: 1 }, OWNER);
    expect(later?.steps).toHaveLength(0);
  });

  it("stops a live run, revokes the lease, and refuses further reports", async () => {
    await hire("Worker");
    const task = await createTask.call({ title: "Work" }, OWNER);
    const claim = await claimTask.call({}, asAgent("Worker"));
    const stopped = await stopRun.call({ runId: claim!.runId, reason: "Enough." }, OWNER);
    expect(stopped.status).toBe("cancelled");
    expect(stopped.leaseExpiresAt).toBeNull();
    expect(stopped.taskStatus).toBe("queued");
    const [row] = await db().select().from(agentTasks).where(eq(agentTasks.id, task.id));
    expect(row?.status).toBe("queued");
    expect(
      (await failure(reportStep.call({ runId: claim!.runId, kind: "note" }, asAgent("Worker"))))
        .code,
    ).toBe("conflict");
  });

  it("cancelling a running task also ends its run", async () => {
    await hire("Worker");
    const task = await createTask.call({ title: "Work" }, OWNER);
    const claim = await claimTask.call({}, asAgent("Worker"));
    await cancelTask.call({ id: task.id, reason: "Stop now." }, OWNER);
    const [run] = await db().select().from(agentRuns).where(eq(agentRuns.id, claim!.runId));
    expect(run?.status).toBe("cancelled");
    expect(run?.leaseExpiresAt).toBeNull();
    const viewed = await getTask.call({ id: task.id }, OWNER);
    expect(viewed?.status).toBe("cancelled");
  });

  it("retries parked work by clearing attempts so it can be claimed again", async () => {
    await hire("Worker");
    const task = await createTask.call({ title: "Work" }, OWNER);
    const claim = await claimTask.call({}, asAgent("Worker"));
    await completeTask.call(
      { runId: claim!.runId, outcome: "refused", failureReason: "No." },
      asAgent("Worker"),
    );
    const retried = await retryTask.call({ id: task.id }, OWNER);
    expect(retried.status).toBe("queued");
    expect(retried.attempts).toBe(0);
    expect(await claimTask.call({}, asAgent("Worker"))).not.toBeNull();
  });

  it("refuses to retry a live run", async () => {
    await hire("Worker");
    const task = await createTask.call({ title: "Work" }, OWNER);
    await claimTask.call({}, asAgent("Worker"));
    expect((await failure(retryTask.call({ id: task.id }, OWNER))).code).toBe("conflict");
  });
});
