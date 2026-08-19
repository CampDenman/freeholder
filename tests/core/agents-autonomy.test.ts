// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Managed writes honour suggest / approve / autonomous (C4.03).
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { users } from "@/core/auth/schema";
import { contacts } from "@/core/contacts/schema";
import { agentApprovals } from "@/core/agents/schema";
import { createContact, getContact } from "@/core/contacts/service";
import {
  connectAgentRuntime,
  createTask,
  hireAgent,
  pauseAllAgents,
} from "@/core/agents/service";
import { claimTask } from "@/core/agents/execution";
import { listApprovals, proposeWrite } from "@/core/agents/writes";
import {
  alwaysRequiresApproval,
  buildWritePreview,
  classifyManagedWrite,
} from "@/core/agents/previews";
import { getService, type Actor } from "@/core/service";
import { ready } from "@/core/runtime";
import { closeDb, failure, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

function asAgent(name: string, scopes: string[] = ["contacts.update"]): Actor {
  return { kind: "agent", keyName: `agent:${name}`, scopes };
}

async function hire(
  name: string,
  autonomy: "suggest" | "approve" | "autonomous",
  toolScopes: string[] = ["contacts.update"],
) {
  const link = await connectAgentRuntime.call(
    { name: `runtime-${name}`, kind: "inbound" },
    OWNER,
  );
  return hireAgent.call(
    {
      connectionId: link.id,
      name,
      role: "writer",
      toolScopes,
      autonomy,
    },
    OWNER,
  );
}

describe("write classification (C4.03)", () => {
  it("classifies from the declared writeClass, never from the name", () => {
    expect(classifyManagedWrite({ name: "cms.updatePage", writeClass: "blocks" })).toEqual({
      kind: "blocks",
      declared: true,
    });
    expect(
      classifyManagedWrite({ name: "cms.deleteDraftPage", writeClass: "destructive" }),
    ).toEqual({ kind: "destructive", declared: true });
    expect(classifyManagedWrite({ name: "anything.at.all", writeClass: "money" })).toEqual({
      kind: "money",
      declared: true,
    });
  });

  it("fails closed on a mutation that never declared a class", () => {
    const classification = classifyManagedWrite({ name: "somemodule.someVerb" });
    expect(classification).toEqual({ kind: "write", declared: false });
    expect(alwaysRequiresApproval(classification)).toBe(true);
    expect(
      alwaysRequiresApproval(classifyManagedWrite({ name: "x.y", writeClass: "write" })),
    ).toBe(false);
    expect(
      alwaysRequiresApproval(classifyManagedWrite({ name: "x.y", writeClass: "destructive" })),
    ).toBe(true);
  });

  it("builds the four preview shapes an owner can actually decide from", () => {
    expect(
      buildWritePreview("blocks", "cms.updatePage", { id: "p1", blocks: [{ type: "heading" }] }),
    ).toMatchObject({ kind: "blocks", after: [{ type: "heading" }] });
    expect(
      buildWritePreview("message", "cms.testSendEmail", { to: "rae@example.test", subject: "Hi", text: "Hello" }),
    ).toMatchObject({ kind: "message", to: "rae@example.test", subject: "Hi", body: "Hello" });
    expect(
      buildWritePreview("money", "invoicing.createRefund", { amountMinor: 1999, currency: "USD" }),
    ).toMatchObject({ kind: "money", amountMinor: 1999, currency: "USD" });
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

  it("declares destruction on every irreversible verb the old regex missed", async () => {
    await ready();
    for (const name of [
      "cms.deleteDraftPage",
      "cms.deleteSection",
      "contacts.merge",
      "invoicing.void",
      "invoicing.voidCreditNote",
      "catalog.cancelOrder",
      "apikeys.revoke",
      "webhooks.remove",
      "plugins.uninstall",
      "seo.deleteRedirect",
    ]) {
      const classification = classifyManagedWrite(getService(name).def);
      expect(classification, name).toEqual({ kind: "destructive", declared: true });
      expect(alwaysRequiresApproval(classification), name).toBe(true);
    }
    expect(classifyManagedWrite(getService("cms.updatePage").def).kind).toBe("blocks");
    expect(classifyManagedWrite(getService("cms.testSendEmail").def).kind).toBe("message");
    expect(classifyManagedWrite(getService("invoicing.createRefund").def).kind).toBe("money");
    expect(classifyManagedWrite(getService("catalog.payOrder").def).kind).toBe("money");
    expect(classifyManagedWrite(getService("catalog.checkoutCart").def).kind).toBe("money");
    expect(classifyManagedWrite(getService("contacts.resolve").def).declared).toBe(false);
  });

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
    expect(result.approval?.proposedAutonomy).toBe("suggest");
    const still = await getContact.call({ id: person.id }, OWNER);
    expect(still?.name).toBe("Rae");
    expect(await listApprovals.call({ taskId: task.id }, OWNER)).toHaveLength(1);
  });

  it("suggest never escalates: even destruction stays a proposal", async () => {
    await hire("Suggester2", "suggest", ["cms.*"]);
    await createTask.call({ title: "Tidy old drafts" }, OWNER);
    const claim = await claimTask.call({}, asAgent("Suggester2", ["cms.*"]));
    const result = await proposeWrite.call(
      {
        runId: claim!.runId,
        serviceName: "cms.deleteDraftPage",
        input: { id: "00000000-0000-4000-8000-000000000042" },
      },
      asAgent("Suggester2", ["cms.*"]),
    );
    expect(result.outcome).toBe("proposed");
    expect(result.approval?.kind).toBe("destructive");
    expect(result.approval?.proposedAutonomy).toBe("suggest");
    const { getTask } = await import("@/core/agents/service");
    const after = await getTask.call({ id: claim!.task.id }, OWNER);
    expect(after?.status).not.toBe("waiting_approval");
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
    expect(result.approval?.proposedAutonomy).toBe("approve");
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
    await hire("Doer2", "autonomous", ["invoicing.void"]);
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

  it("queues camelCase destruction even at autonomous", async () => {
    await hire("Doer4", "autonomous", ["cms.*"]);
    await createTask.call({ title: "Tidy old drafts" }, OWNER);
    const claim = await claimTask.call({}, asAgent("Doer4", ["cms.*"]));
    const result = await proposeWrite.call(
      {
        runId: claim!.runId,
        serviceName: "cms.deleteDraftPage",
        input: { id: "00000000-0000-4000-8000-000000000042" },
      },
      asAgent("Doer4", ["cms.*"]),
    );
    expect(result.outcome).toBe("awaiting_approval");
    expect(result.approval?.kind).toBe("destructive");
  });

  it("fails closed: an undeclared mutation queues even at autonomous", async () => {
    await hire("Doer5", "autonomous", ["contacts.resolve"]);
    await createTask.call({ title: "Register an enquiry" }, OWNER);
    const claim = await claimTask.call({}, asAgent("Doer5", ["contacts.resolve"]));
    const result = await proposeWrite.call(
      {
        runId: claim!.runId,
        serviceName: "contacts.resolve",
        input: { email: "new@example.test", name: "New Person" },
      },
      asAgent("Doer5", ["contacts.resolve"]),
    );
    expect(result.outcome).toBe("awaiting_approval");
    const created = await db()
      .select()
      .from(contacts)
      .where(eq(contacts.email, "new@example.test"));
    expect(created).toHaveLength(0);
  });

  it("the kill switch also stops the write gate", async () => {
    await hire("Doer6", "autonomous");
    const person = await createContact.call({ name: "Rae", email: "rae6@example.test" }, OWNER);
    await createTask.call({ title: "Rename Rae" }, OWNER);
    const claim = await claimTask.call({}, asAgent("Doer6"));
    await pauseAllAgents.call({ paused: true }, OWNER);
    const refused = await failure(
      proposeWrite.call(
        {
          runId: claim!.runId,
          serviceName: "contacts.update",
          input: { id: person.id, name: "Hacked" },
        },
        asAgent("Doer6"),
      ),
    );
    expect(refused.code).toBe("permission");
    expect((await getContact.call({ id: person.id }, OWNER))?.name).toBe("Rae");
  });

  it("refuses proposals outside the agent's own scopes", async () => {
    await hire("Narrow", "approve");
    await createTask.call({ title: "Try to read a draft" }, OWNER);
    const claim = await claimTask.call({}, asAgent("Narrow"));
    const refused = await failure(
      proposeWrite.call(
        {
          runId: claim!.runId,
          serviceName: "cms.updatePage",
          input: { id: "00000000-0000-4000-8000-000000000042", blocks: [] },
        },
        asAgent("Narrow"),
      ),
    );
    expect(refused.code).toBe("permission");
    expect(await listApprovals.call({}, OWNER)).toHaveLength(0);
  });

  it("stores approved input verbatim and redacts every read of it", async () => {
    await hire("Reviewer2", "approve");
    const person = await createContact.call({ name: "Rae", email: "rae7@example.test" }, OWNER);
    await createTask.call({ title: "Rename Rae" }, OWNER);
    const claim = await claimTask.call({}, asAgent("Reviewer2"));
    const result = await proposeWrite.call(
      {
        runId: claim!.runId,
        serviceName: "contacts.update",
        input: { id: person.id, name: "Rae Lane", apiToken: "s3cret" },
      },
      asAgent("Reviewer2"),
    );
    expect((result.approval?.input as Record<string, unknown>).apiToken).toBe("[redacted]");
    const [stored] = await db()
      .select()
      .from(agentApprovals)
      .where(eq(agentApprovals.id, result.approval!.id));
    expect((stored!.input as Record<string, unknown>).apiToken).toBe("s3cret");
    const [listedRow] = await listApprovals.call({}, OWNER);
    expect((listedRow!.input as Record<string, unknown>).apiToken).toBe("[redacted]");
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
