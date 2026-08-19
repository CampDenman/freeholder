// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Managed writes honour suggest / approve / autonomous (C4.03).
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/core/db";
import { users } from "@/core/auth/schema";
import { createContact, getContact } from "@/core/contacts/service";
import {
  connectAgentRuntime,
  createTask,
  hireAgent,
} from "@/core/agents/service";
import { claimTask } from "@/core/agents/execution";
import { listApprovals, proposeWrite } from "@/core/agents/writes";
import {
  alwaysRequiresApproval,
  classifyManagedWrite,
  buildWritePreview,
} from "@/core/agents/previews";
import type { Actor } from "@/core/service";
import { closeDb, failure, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

function asAgent(name: string, scopes: string[] = ["contacts.update"]): Actor {
  return { kind: "agent", keyName: `agent:${name}`, scopes };
}

async function hire(name: string, autonomy: "suggest" | "approve" | "autonomous") {
  const link = await connectAgentRuntime.call(
    { name: `runtime-${name}`, kind: "inbound" },
    OWNER,
  );
  return hireAgent.call(
    {
      connectionId: link.id,
      name,
      role: "writer",
      toolScopes: ["contacts.update"],
      autonomy,
    },
    OWNER,
  );
}

describe("write classification (C4.03)", () => {
  it("names block diffs, messages, money and irreversible work", () => {
    expect(classifyManagedWrite("cms.updatePage", { blocks: [] })).toBe("blocks");
    expect(classifyManagedWrite("mail.send", { to: "a@b.c", subject: "Hi", text: "Hello" })).toBe(
      "message",
    );
    expect(classifyManagedWrite("invoicing.createRefund", { amountCents: 500 })).toBe("money");
    expect(classifyManagedWrite("invoicing.void", { id: "x" })).toBe("destructive");
    expect(classifyManagedWrite("contacts.update", { id: "x", name: "Rae" })).toBe("write");
    expect(alwaysRequiresApproval("destructive")).toBe(true);
    expect(alwaysRequiresApproval("write")).toBe(false);
  });

  it("builds the four preview shapes an owner can actually decide from", () => {
    expect(
      buildWritePreview("blocks", "cms.updatePage", { id: "p1", blocks: [{ type: "heading" }] }),
    ).toMatchObject({ kind: "blocks", after: [{ type: "heading" }] });
    expect(
      buildWritePreview("message", "mail.send", { to: "rae@example.test", subject: "Hi", text: "Hello" }),
    ).toMatchObject({ kind: "message", to: "rae@example.test", subject: "Hi", body: "Hello" });
    expect(
      buildWritePreview("money", "invoicing.createRefund", { amountCents: 1999, currency: "USD" }),
    ).toMatchObject({ kind: "money", amountCents: 1999, currency: "USD" });
    expect(buildWritePreview("destructive", "invoicing.void", { id: "inv-1" })).toMatchObject({
      kind: "destructive",
      subjectId: "inv-1",
    });
  });
});

describe.runIf(hasDatabase)("managed writes", { timeout: 30_000 }, () => {
  beforeEach(async () => {
    await truncateSpine();
    await db()
      .insert(users)
      .values({ id: OWNER.userId, email: "owner@example.test", role: "owner" })
      .onConflictDoNothing();
  });
  afterAll(closeDb);

  it("suggest produces a proposal and does not write", async () => {
    await hire("Suggester", "suggest");
    const person = await createContact.call({ name: "Rae", email: "rae@example.test" }, OWNER);
    const task = await createTask.call({ title: "Rename Rae" }, OWNER);
    const claim = await claimTask.call({}, asAgent("Suggester"));
    const result = await proposeWrite.call(
      {
        runId: claim!.runId,
        serviceName: "contacts.update",
        input: { id: person.id, name: "Rae Lane" },
      },
      asAgent("Suggester"),
    );
    expect(result.outcome).toBe("proposed");
    expect(result.approval?.kind).toBe("write");
    const still = await getContact.call({ id: person.id }, OWNER);
    expect(still?.name).toBe("Rae");
    expect(await listApprovals.call({ taskId: task.id }, OWNER)).toHaveLength(1);
  });

  it("approve parks a previewed write on waiting_approval", async () => {
    await hire("Reviewer", "approve");
    const person = await createContact.call({ name: "Rae", email: "rae2@example.test" }, OWNER);
    await createTask.call({ title: "Rename Rae" }, OWNER);
    const claim = await claimTask.call({}, asAgent("Reviewer"));
    const result = await proposeWrite.call(
      {
        runId: claim!.runId,
        serviceName: "contacts.update",
        input: { id: person.id, name: "Rae Lane" },
      },
      asAgent("Reviewer"),
    );
    expect(result.outcome).toBe("awaiting_approval");
    const { getTask } = await import("@/core/agents/service");
    const after = await getTask.call({ id: claim!.task.id }, OWNER);
    expect(after?.status).toBe("waiting_approval");
    expect(after && (await getContact.call({ id: person.id }, OWNER))?.name).toBe("Rae");
  });

  it("autonomous executes an ordinary write", async () => {
    await hire("Doer", "autonomous");
    const person = await createContact.call({ name: "Rae", email: "rae3@example.test" }, OWNER);
    await createTask.call({ title: "Rename Rae" }, OWNER);
    const claim = await claimTask.call({}, asAgent("Doer"));
    const result = await proposeWrite.call(
      {
        runId: claim!.runId,
        serviceName: "contacts.update",
        input: { id: person.id, name: "Rae Lane" },
      },
      asAgent("Doer"),
    );
    expect(result.outcome).toBe("executed");
    expect((await getContact.call({ id: person.id }, OWNER))?.name).toBe("Rae Lane");
  });

  it("never lets autonomous skip approval for irreversible work", async () => {
    await hire("Doer2", "autonomous");
    await createTask.call({ title: "Void an invoice" }, OWNER);
    const claim = await claimTask.call({}, asAgent("Doer2", ["invoicing.void"]));
    const result = await proposeWrite.call(
      {
        runId: claim!.runId,
        serviceName: "invoicing.void",
        input: { id: "00000000-0000-4000-8000-000000000099", reason: "Duplicate." },
      },
      asAgent("Doer2", ["invoicing.void"]),
    );
    expect(result.outcome).toBe("awaiting_approval");
    expect(result.approval?.kind).toBe("destructive");
    expect(result.approval?.preview).toMatchObject({ kind: "destructive" });
  });

  it("untrusted input forces suggest even when the agent is autonomous", async () => {
    await hire("Doer3", "autonomous");
    const person = await createContact.call({ name: "Rae", email: "rae4@example.test" }, OWNER);
    await createTask.call(
      { title: "Customer asked to rename", inputTrust: "untrusted" },
      OWNER,
    );
    const claim = await claimTask.call({}, asAgent("Doer3"));
    const result = await proposeWrite.call(
      {
        runId: claim!.runId,
        serviceName: "contacts.update",
        input: { id: person.id, name: "Hacked" },
      },
      asAgent("Doer3"),
    );
    expect(result.outcome).toBe("proposed");
    expect((await getContact.call({ id: person.id }, OWNER))?.name).toBe("Rae");
  });

  it("refuses a person at the managed-write gate", async () => {
    expect(
      (await failure(proposeWrite.call({ runId: "00000000-0000-4000-8000-000000000001", serviceName: "contacts.list" }, OWNER)))
        .code,
    ).toBe("permission");
  });
});
