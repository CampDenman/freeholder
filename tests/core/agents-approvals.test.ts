// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The approval inbox: expiry, rejection notes, step-up, once-only execution
// and an immutable decision audit (C4.04).
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db } from "@/core/db";
import { users } from "@/core/auth/schema";
import { runApprovals } from "@/core/runs/schema";
import { createContact, getContact } from "@/core/contacts/service";
import { connectAgentRuntime, createTask, getTask, hireAgent } from "@/core/agents/service";
import { claimTask } from "@/core/agents/execution";
import {
  approveWrite,
  expireApprovals,
  listApprovals,
  proposeWrite,
  rejectWrite,
} from "@/core/agents/writes";
import type { Actor } from "@/core/service";
import { closeDb, failure, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

function asAgent(name: string, scopes: string[] = ["contacts.update"]): Actor {
  return { kind: "agent", keyName: `agent:${name}`, scopes };
}

/** An interactive session whose second factor has gone stale. */
const STALE_STEP_UP: Actor = {
  ...OWNER,
  security: {
    twoFactorRequired: false,
    twoFactorEnrolled: true,
    twoFactorVerified: true,
    stepUpValid: false,
  },
};

async function parkedWrite(agentName: string, email: string) {
  const link = await connectAgentRuntime.call(
    { name: `runtime-${agentName}`, kind: "inbound" },
    OWNER,
  );
  await hireAgent.call(
    {
      connectionId: link.id,
      name: agentName,
      role: "writer",
      toolScopes: ["contacts.update"],
      autonomy: "approve",
    },
    OWNER,
  );
  const person = await createContact.call({ name: "Rae", email }, OWNER);
  const task = await createTask.call({ title: `Rename ${email}` }, OWNER);
  const claim = await claimTask.call({}, asAgent(agentName));
  const proposed = await proposeWrite.call(
    {
      runId: claim!.runId,
      serviceName: "contacts.update",
      input: { id: person.id, name: "Rae Lane" },
    },
    asAgent(agentName),
  );
  return { person, task, approval: proposed.approval! };
}

describe.runIf(hasDatabase)("the approval inbox (C4.04)", { timeout: 30_000 }, () => {
  beforeEach(async () => {
    await truncateSpine();
    await db()
      .insert(users)
      .values({ id: OWNER.userId, email: "owner@example.test", role: "owner" })
      .onConflictDoNothing();
  });
  afterAll(closeDb);

  it("approving executes the stored input exactly once and releases the task", async () => {
    const { person, task, approval } = await parkedWrite("Approver1", "a1@example.test");
    const before = await getTask.call({ id: task.id }, OWNER);
    expect(before?.status).toBe("waiting_approval");

    const decided = await approveWrite.call({ id: approval.id, note: "Looks right." }, OWNER);
    expect(decided.approval.status).toBe("approved");
    expect((await getContact.call({ id: person.id }, OWNER))?.name).toBe("Rae Lane");
    const after = await getTask.call({ id: task.id }, OWNER);
    expect(after?.status).toBe("queued");

    // Exactly once: a second decision on the same row is refused, and the
    // write does not run again.
    const again = await failure(approveWrite.call({ id: approval.id }, OWNER));
    expect(again.code).toBe("conflict");
  });

  it("keeps the decision immutable once made", async () => {
    const { approval } = await parkedWrite("Approver2", "a2@example.test");
    await rejectWrite.call({ id: approval.id, note: "Wrong person." }, OWNER);
    expect((await failure(approveWrite.call({ id: approval.id }, OWNER))).code).toBe("conflict");
    expect(
      (await failure(rejectWrite.call({ id: approval.id, note: "Again." }, OWNER))).code,
    ).toBe("conflict");
    const [row] = await listApprovals.call({ status: "rejected" }, OWNER);
    expect(row?.decisionNote).toBe("Wrong person.");
    expect(row?.decidedBy).toBe(OWNER.userId);
    expect(row?.decidedAt).toBeTruthy();
  });

  it("rejection requires a note and returns the task to the queue", async () => {
    const { person, task, approval } = await parkedWrite("Approver3", "a3@example.test");
    expect(
      (await failure(rejectWrite.call({ id: approval.id, note: "" }, OWNER))).code,
    ).toBe("validation");
    await rejectWrite.call({ id: approval.id, note: "Not this quarter." }, OWNER);
    expect((await getContact.call({ id: person.id }, OWNER))?.name).toBe("Rae");
    expect((await getTask.call({ id: task.id }, OWNER))?.status).toBe("queued");
  });

  it("approving runs under the approver's own permissions", async () => {
    const { approval } = await parkedWrite("Approver4", "a4@example.test");
    const limited: Actor = {
      kind: "user",
      userId: OWNER.userId,
      role: "bookkeeper",
      grants: [{ module: "agents", access: "manage" }],
    };
    // The claim would succeed, but executing contacts.update is outside this
    // person's grants — the whole transaction rolls back, so the approval is
    // still pending for someone who is allowed to make the call.
    const refused = await failure(approveWrite.call({ id: approval.id }, limited));
    expect(refused.code).toBe("permission");
    const [row] = await listApprovals.call({ status: "pending" }, OWNER);
    expect(row?.id).toBe(approval.id);
  });

  it("expiry lapses unanswered approvals and releases their tasks", async () => {
    const { person, task, approval } = await parkedWrite("Approver5", "a5@example.test");
    await db()
      .update(runApprovals)
      .set({ expiresAt: sql`now() - interval '1 minute'` })
      .where(eq(runApprovals.id, approval.id));
    const swept = await expireApprovals.call({}, { kind: "system" });
    expect(swept.expired).toBe(1);
    expect((await getTask.call({ id: task.id }, OWNER))?.status).toBe("queued");
    expect((await getContact.call({ id: person.id }, OWNER))?.name).toBe("Rae");
    expect((await failure(approveWrite.call({ id: approval.id }, OWNER))).code).toBe("conflict");
  });

  it("demands a fresh second factor and a person", async () => {
    const { approval } = await parkedWrite("Approver6", "a6@example.test");
    expect(
      (await failure(approveWrite.call({ id: approval.id }, STALE_STEP_UP))).code,
    ).toBe("step_up_required");
    expect(
      (await failure(approveWrite.call({ id: approval.id }, asAgent("Approver6")))).code,
    ).toBe("permission");
    expect(
      (await failure(rejectWrite.call({ id: approval.id, note: "No." }, { kind: "system" }))).code,
    ).toBe("permission");
  });
});
