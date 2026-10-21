// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Per-agent pause and the kill switch (C4.07, MASTER.md §40): stop new claims
// *and* safely end the leases already out.
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { users } from "@/core/auth/schema";
import { runs } from "@/core/runs/schema";
import {
  connectAgentRuntime,
  createTask,
  getTask,
  hireAgent,
  listAgents,
  pauseAgent,
  pauseAllAgents,
} from "@/core/agents/service";
import { claimTask } from "@/core/agents/execution";
import { runManagedAgentWork } from "@/core/agents/managed";
import { setWorkforceOpenAiFetchForTests } from "@/adapters/agent/workforce-openai";
import type { Actor } from "@/core/service";
import { closeDb, failure, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

const KEY_VAR = "TEST_PAUSE_LOOP_KEY";

function asAgent(name: string, scopes: string[] = ["contacts.list"]): Actor {
  return { kind: "agent", keyName: `agent:${name}`, scopes };
}

async function hireManaged(name: string, kind: "managed" | "inbound" = "managed") {
  const connection = await connectAgentRuntime.call(
    {
      name: `runtime-${name}`,
      kind,
      ...(kind === "managed"
        ? {
            adapter: "openai" as const,
            model: "gpt-test",
            credentialRef: KEY_VAR,
            inputCentsPerMillion: 100,
            outputCentsPerMillion: 500,
          }
        : {}),
    },
    OWNER,
  );
  return hireAgent.call(
    {
      connectionId: connection.id,
      name,
      role: "worker",
      toolScopes: ["contacts.list"],
      autonomy: "autonomous",
      budgetCents: 100_000,
      budgetPeriod: "month",
    },
    OWNER,
  );
}

describe.runIf(hasDatabase)("pausing a workforce", { timeout: 60_000 }, () => {
  beforeEach(async () => {
    await truncateSpine();
    await db()
      .insert(users)
      .values({ id: OWNER.userId, email: "owner@example.test", role: "owner" })
      .onConflictDoNothing();
    process.env[KEY_VAR] = "test-key";
  });
  afterEach(() => {
    setWorkforceOpenAiFetchForTests(undefined);
    delete process.env[KEY_VAR];
  });
  afterAll(closeDb);

  it("ends the run an agent is holding and gives the work back", async () => {
    const agent = await hireManaged("Busy", "inbound");
    const task = await createTask.call({ title: "Long job" }, OWNER);
    const claim = await claimTask.call({}, asAgent("Busy"));
    expect(claim).not.toBeNull();

    const paused = await pauseAgent.call({ id: agent.id }, OWNER);
    expect(paused).toMatchObject({ status: "paused", stoppedRuns: 1 });

    // The lease is revoked rather than left to lapse: an owner who hits pause
    // should not wait ten minutes for the agent to actually stop.
    const [run] = await db().select().from(runs).where(eq(runs.id, claim!.runId));
    expect(run?.status).toBe("cancelled");
    expect(run?.stopReason).toBe("cancelled");
    expect(run?.leaseExpiresAt).toBeNull();
    // And the work is back on the queue rather than lost.
    expect((await getTask.call({ id: task.id }, OWNER))?.status).toBe("queued");
  });

  it("stops the paused agent claiming anything new", async () => {
    const agent = await hireManaged("Stopped", "inbound");
    await createTask.call({ title: "Waiting work" }, OWNER);
    await pauseAgent.call({ id: agent.id }, OWNER);

    expect((await failure(claimTask.call({}, asAgent("Stopped")))).code).toBe("permission");

    // Resuming is the other half: the same agent takes the same work.
    const resumed = await pauseAgent.call({ id: agent.id, paused: false }, OWNER);
    expect(resumed).toMatchObject({ status: "active", stoppedRuns: 0 });
    expect(await claimTask.call({}, asAgent("Stopped"))).not.toBeNull();
  });

  it("the kill switch stops every worker and every run at once", async () => {
    await hireManaged("One", "inbound");
    await hireManaged("Two", "inbound");
    await createTask.call({ title: "Job one" }, OWNER);
    await createTask.call({ title: "Job two" }, OWNER);
    const first = await claimTask.call({}, asAgent("One"));
    const second = await claimTask.call({}, asAgent("Two"));

    const killed = await pauseAllAgents.call({}, OWNER);
    expect(killed).toEqual({ changed: 2, stoppedRuns: 2 });
    for (const claim of [first, second]) {
      const [run] = await db().select().from(runs).where(eq(runs.id, claim!.runId));
      expect(run?.status).toBe("cancelled");
    }
    const agents = await listAgents.call({}, OWNER);
    expect(agents.every((agent) => agent.status === "paused")).toBe(true);
  });

  it("a managed run in flight notices within one turn", async () => {
    const agent = await hireManaged("Looper");
    await createTask.call({ title: "Keeps going" }, OWNER);
    // The model always asks for another tool call, so only the kill switch
    // can end this run. Pausing mid-flight, between turns, is what an owner
    // hitting the switch actually does.
    let turns = 0;
    setWorkforceOpenAiFetchForTests(async () => {
      turns += 1;
      if (turns === 1) {
        await pauseAllAgents.call({}, OWNER);
      }
      return new Response(
        JSON.stringify({
          model: "gpt-test",
          choices: [
            {
              finish_reason: "tool_calls",
              message: {
                content: null,
                tool_calls: [
                  { id: `call_${turns}`, function: { name: "contacts_list", arguments: "{}" } },
                ],
              },
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });

    await runManagedAgentWork();
    // One turn happened; the second was never sent, because the loop checks
    // whether the run is still its own before spending anything.
    expect(turns).toBe(1);
    const runRows = await db().select().from(runs).where(eq(runs.agentId, agent.id));
    expect(runRows).toHaveLength(1);
    expect(runRows[0]?.status).toBe("cancelled");
    // The loop did not overwrite the task the pause re-queued.
    const [task] = await db().select().from(runs);
    expect(task).toBeTruthy();
    const tasks = await getTask.call({ id: runRows[0]!.subjectId }, OWNER);
    expect(tasks?.status).toBe("queued");
  });

  it("refuses to let an agent pause anything", async () => {
    const agent = await hireManaged("Sneaky", "inbound");
    const refused = await failure(
      pauseAgent.call({ id: agent.id }, asAgent("Sneaky", ["agents.*"])),
    );
    expect(refused.code).toBe("permission");
    expect(
      (await failure(pauseAllAgents.call({}, asAgent("Sneaky", ["agents.*"])))).code,
    ).toBe("permission");
  });
});
