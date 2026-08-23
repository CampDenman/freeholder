// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Pipelines, stages and deals (C7.01, MASTER.md §4.1).
//
// Two claims from §4.1, and the second is the delicate one:
//
//   1. **"A deal is optional... the module is inert until an owner defines a
//      stage."** Installing the module changes nothing; opening a deal before
//      there is a pipeline says so rather than inventing one.
//   2. **"The hardcoded lifecycle_stage becomes a definable pipeline"** — with
//      one write path and one direction of derivation, so the configurable
//      stage and the spine enum can never disagree. Two independently editable
//      notions of what stage somebody is at would be the exact fork the
//      contact spine exists to prevent.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { users } from "@/core/auth/schema";
import { contacts } from "@/core/contacts/schema";
import { contactStages, deals, pipelineStages, pipelines } from "@/modules/crm/schema";
import { db } from "@/core/db";
import { ready } from "@/core/runtime";
import { getService } from "@/core/service";
import {
  createDeal,
  installPipelineDefaults,
  lifecycleBoard,
  listDeals,
  listPipelines,
  moveContactStage,
  moveDeal,
  removeStage,
  savePipeline,
  saveStage,
  updateDeal,
} from "@/modules/crm/service";
import { closeDb, failure, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

describe.runIf(hasDatabase)("pipelines and deals", { timeout: 90_000 }, () => {
  beforeEach(async () => {
    await ready();
    await truncateSpine();
    await db()
      .insert(users)
      .values({ id: OWNER.userId, email: "owner@example.test", role: "owner" })
      .onConflictDoNothing();
  }, 60_000);

  afterAll(async () => {
    await truncateSpine();
    await closeDb();
  });

  async function contactId(): Promise<string> {
    const resolved = (await getService("contacts.resolve").call(
      { email: "rae@example.test", name: "Rae Lane", source: "test" },
      { kind: "system" },
    )) as { contact: { id: string } };
    return resolved.contact.id;
  }

  async function stagesOf(kind: "lifecycle" | "deal") {
    const boards = await listPipelines.call({ kind }, OWNER);
    return boards[0]!.stages;
  }

  // §4.1: the module is inert until an owner defines a stage.
  it("carries no pipelines until somebody asks for them", async () => {
    expect(await listPipelines.call({}, OWNER)).toEqual([]);
    const refused = await failure(
      createDeal.call({ contactId: await contactId(), title: "A job" }, OWNER),
    );
    // Said plainly rather than inventing a pipeline the owner never chose.
    expect(refused.message).toContain("Set up a sales pipeline");
  });

  it("installs the standard ladders when asked, and only once", async () => {
    const installed = await installPipelineDefaults.call({}, OWNER);
    expect(installed).toMatchObject({ pipelines: 2, stages: 11 });

    const again = await failure(installPipelineDefaults.call({}, OWNER));
    // Two "Lead" columns and no way to tell which one anybody is in.
    expect(again.message).toContain("already set up");
  });

  it("opens a deal on the default board without being told which", async () => {
    await installPipelineDefaults.call({}, OWNER);
    const deal = await createDeal.call(
      { contactId: await contactId(), title: "Kitchen refit", valueMinor: 400_000 },
      OWNER,
    );
    const first = (await stagesOf("deal"))[0]!;
    // The first stage of the default pipeline, so a deal from a form lands
    // somewhere sensible without the caller knowing the board.
    expect(deal.stageId).toBe(first.id);
    expect(deal.status).toBe("open");
  });

  it("weights the board by the stage's own odds", async () => {
    await installPipelineDefaults.call({}, OWNER);
    const deal = await createDeal.call(
      { contactId: await contactId(), title: "Kitchen refit", valueMinor: 400_000 },
      OWNER,
    );
    const board = await listDeals.call({}, OWNER);
    // Enquiry is 10%: £4,000 of pipeline is £400 of forecast.
    expect(board[0]).toMatchObject({ effectiveProbability: 10, weightedMinor: 40_000 });

    // And a deal that is unusual overrides it, without every other deal
    // needing a number typed on it.
    await updateDeal.call({ id: deal.id, probability: 90 }, OWNER);
    const after = await listDeals.call({}, OWNER);
    expect(after[0]).toMatchObject({ effectiveProbability: 90, weightedMinor: 360_000 });
  });

  it("records a move rather than quietly updating a column", async () => {
    await installPipelineDefaults.call({}, OWNER);
    const deal = await createDeal.call(
      { contactId: await contactId(), title: "Kitchen refit" },
      OWNER,
    );
    const stages = await stagesOf("deal");
    const quoted = stages.find((stage) => stage.name === "Quoted")!;
    const moved = await moveDeal.call({ id: deal.id, stageId: quoted.id }, OWNER);
    expect(moved.stageId).toBe(quoted.id);
    expect(moved.status).toBe("open");

    const { timelineEvents } = await import("@/core/contacts/schema");
    const timeline = await db()
      .select()
      .from(timelineEvents)
      .where(eq(timelineEvents.subjectType, "deal"));
    // Opened and moved: §4.1's transitions are events, and the CRM reads them.
    expect(timeline.map((entry) => entry.eventType).sort()).toEqual([
      "deal.moved",
      "deal.opened",
    ]);
  });

  it("closes a deal when it reaches an end of the ladder", async () => {
    await installPipelineDefaults.call({}, OWNER);
    const deal = await createDeal.call(
      { contactId: await contactId(), title: "Kitchen refit" },
      OWNER,
    );
    const stages = await stagesOf("deal");
    const won = await moveDeal.call(
      { id: deal.id, stageId: stages.find((stage) => stage.isWon)!.id },
      OWNER,
    );
    expect(won).toMatchObject({ status: "won" });
    expect(won.closedAt).toBeTruthy();
  });

  // §4.1: the reason is the only thing a lost deal is still worth, and the
  // moment it is lost is the only moment anybody knows it.
  it("insists on a reason before it will lose a deal", async () => {
    await installPipelineDefaults.call({}, OWNER);
    const deal = await createDeal.call(
      { contactId: await contactId(), title: "Kitchen refit" },
      OWNER,
    );
    const lostStage = (await stagesOf("deal")).find((stage) => stage.isLost)!;
    const refused = await failure(
      moveDeal.call({ id: deal.id, stageId: lostStage.id }, OWNER),
    );
    expect(refused.message).toContain("why it was lost");

    const lost = await moveDeal.call(
      { id: deal.id, stageId: lostStage.id, lostReason: "Went with a cheaper quote." },
      OWNER,
    );
    expect(lost).toMatchObject({ status: "lost", lostReason: "Went with a cheaper quote." });
  });

  it("clears the closing stamp when a deal comes back to life", async () => {
    await installPipelineDefaults.call({}, OWNER);
    const deal = await createDeal.call(
      { contactId: await contactId(), title: "Kitchen refit" },
      OWNER,
    );
    const stages = await stagesOf("deal");
    await moveDeal.call(
      {
        id: deal.id,
        stageId: stages.find((stage) => stage.isLost)!.id,
        lostReason: "Too expensive.",
      },
      OWNER,
    );
    const reopened = await moveDeal.call(
      { id: deal.id, stageId: stages.find((stage) => stage.name === "Negotiating")!.id },
      OWNER,
    );
    // Not permanently stamped with the day it was briefly lost.
    expect(reopened).toMatchObject({ status: "open", closedAt: null, lostReason: null });
  });

  it("will not move a deal onto another board's stage", async () => {
    await installPipelineDefaults.call({}, OWNER);
    const deal = await createDeal.call(
      { contactId: await contactId(), title: "Kitchen refit" },
      OWNER,
    );
    const lifecycle = (await stagesOf("lifecycle"))[0]!;
    const refused = await failure(
      moveDeal.call({ id: deal.id, stageId: lifecycle.id }, OWNER),
    );
    // Its history would describe a ladder it is no longer on.
    expect(refused.message).toContain("different pipeline");
  });

  // The delicate claim: one write path, one direction of derivation.
  it("keeps the spine's lifecycle in step with the owner's own stage", async () => {
    await installPipelineDefaults.call({}, OWNER);
    const id = await contactId();
    const stages = await stagesOf("lifecycle");

    await moveContactStage.call(
      { contactId: id, stageId: stages.find((stage) => stage.name === "Prospect")!.id },
      OWNER,
    );
    const [afterProspect] = await db()
      .select({ stage: contacts.lifecycleStage })
      .from(contacts)
      .where(eq(contacts.id, id));
    expect(afterProspect!.stage).toBe("prospect");

    // "Advocate" has no coarse equivalent of its own, so it derives the
    // nearest true one — somebody who advocates has bought more than once.
    await moveContactStage.call(
      { contactId: id, stageId: stages.find((stage) => stage.name === "Advocate")!.id },
      OWNER,
    );
    const [afterAdvocate] = await db()
      .select({ stage: contacts.lifecycleStage })
      .from(contacts)
      .where(eq(contacts.id, id));
    expect(afterAdvocate!.stage).toBe("repeat");

    const board = await lifecycleBoard.call({}, OWNER);
    expect(board[0]).toMatchObject({ contactName: "Rae Lane", stageName: "Advocate" });
  });

  it("refuses a lifecycle stage that derives nothing", async () => {
    const board = await savePipeline.call(
      { kind: "lifecycle", name: "Wholesale", isDefault: true },
      OWNER,
    );
    const refused = await failure(
      saveStage.call({ pipelineId: board.id, name: "Warm" }, OWNER),
    );
    // Without it the spine value would go stale the first time anybody used it.
    expect(refused.message).toContain("reports and price lists");
  });

  it("will not move a contact onto a deal stage", async () => {
    await installPipelineDefaults.call({}, OWNER);
    const dealStage = (await stagesOf("deal"))[0]!;
    const refused = await failure(
      moveContactStage.call({ contactId: await contactId(), stageId: dealStage.id }, OWNER),
    );
    expect(refused.message).toContain("deal stage");
  });

  it("keeps one default pipeline per kind", async () => {
    await installPipelineDefaults.call({}, OWNER);
    const second = await savePipeline.call(
      { kind: "deal", name: "Wholesale", isDefault: true },
      OWNER,
    );
    const boards = await listPipelines.call({ kind: "deal" }, OWNER);
    // §4.1 allows several boards; exactly one of them is where a form's deal
    // lands.
    expect(boards).toHaveLength(2);
    expect(boards.filter((board) => board.isDefault).map((board) => board.id)).toEqual([
      second.id,
    ]);
  });

  it("will not delete a stage with anything sitting in it", async () => {
    await installPipelineDefaults.call({}, OWNER);
    const deal = await createDeal.call(
      { contactId: await contactId(), title: "Kitchen refit" },
      OWNER,
    );
    const refused = await failure(removeStage.call({ id: deal.stageId }, OWNER));
    // Deleting it would silently move things somewhere nobody chose.
    expect(refused.message).toContain("Move what is in this stage");

    const spare = await saveStage.call(
      { pipelineId: deal.pipelineId, name: "On hold" },
      OWNER,
    );
    await removeStage.call({ id: spare.id }, OWNER);
    expect(
      await db().select().from(pipelineStages).where(eq(pipelineStages.id, spare.id)),
    ).toHaveLength(0);
  });

  it("keeps the pipeline and forgets the person", async () => {
    await installPipelineDefaults.call({}, OWNER);
    const id = await contactId();
    await createDeal.call(
      { contactId: id, title: "The Hendersons' kitchen", valueMinor: 400_000 },
      OWNER,
    );
    await moveContactStage.call(
      { contactId: id, stageId: (await stagesOf("lifecycle"))[1]!.id },
      OWNER,
    );

    const { contactPrivacySources } = await import("@/core/privacy/service");
    const source = contactPrivacySources().find((one) => one.scope === "contact.deals");
    expect(source).toBeTruthy();
    await db().transaction((tx) => source!.erase(tx, id, { requestId: "t" }));

    const [after] = await db().select().from(deals);
    // The forecast, the win rate and the history survive; what the business
    // wrote about them does not.
    expect(after).toMatchObject({ title: "Opportunity", valueMinor: 400_000 });
    expect(await db().select().from(contactStages)).toHaveLength(0);
  });

  it("does not move a survivor backwards down the ladder on a merge", async () => {
    const { contactReferences } = await import("@/core/contacts/service");
    const reference = contactReferences().find((one) => one.table === "contact_stages");
    expect(reference).toBeTruthy();

    await installPipelineDefaults.call({}, OWNER);
    const stages = await stagesOf("lifecycle");
    const survivor = await contactId();
    const duplicate = (
      (await getService("contacts.resolve").call(
        { email: "rae2@example.test", name: "Rae Lane", source: "test" },
        { kind: "system" },
      )) as { contact: { id: string } }
    ).contact.id;

    await moveContactStage.call(
      { contactId: survivor, stageId: stages.find((s) => s.name === "Customer")!.id },
      OWNER,
    );
    await moveContactStage.call(
      { contactId: duplicate, stageId: stages.find((s) => s.name === "Lead")!.id },
      OWNER,
    );
    await db().transaction((tx) => reference!.repoint(tx, duplicate, survivor));

    const rows = await db().select().from(contactStages);
    expect(rows).toHaveLength(1);
    // The survivor keeps Customer rather than being dragged back to Lead.
    expect(rows[0]).toMatchObject({
      contactId: survivor,
      stageId: stages.find((s) => s.name === "Customer")!.id,
    });
  });

  it("lets a business run a second board beside the first", async () => {
    await installPipelineDefaults.call({}, OWNER);
    const wholesale = await savePipeline.call({ kind: "deal", name: "Wholesale" }, OWNER);
    const stage = await saveStage.call(
      { pipelineId: wholesale.id, name: "Approached", probability: 20 },
      OWNER,
    );
    const deal = await createDeal.call(
      {
        contactId: await contactId(),
        title: "Trade order",
        pipelineId: wholesale.id,
        stageId: stage.id,
        valueMinor: 1_000_000,
      },
      OWNER,
    );
    const board = await listDeals.call({ pipelineId: wholesale.id }, OWNER);
    expect(board).toHaveLength(1);
    expect(board[0]).toMatchObject({ id: deal.id, weightedMinor: 200_000 });
    // And the retail board is untouched by it.
    expect(await listDeals.call({ pipelineId: deal.pipelineId }, OWNER)).toHaveLength(1);
    expect(await db().select().from(pipelines)).toHaveLength(3);
  });
});
