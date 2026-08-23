// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Lead scoring you can read (C7.05, MASTER.md §4.14).
//
// §4.14: "Lead scoring is transparent by construction: rules over spine events
// with visible points and stated decay, never a model. An owner must be able to
// read why someone is a 40."
//
// Five claims:
//
//   1. **There is no score column**, so there is no black-box path. The number
//      is the sum of the ledger, and the explanation is the same rows.
//   2. **Decay is stated and frozen at award time.** Lowering a rule in March
//      changes what future behaviour is worth, not what somebody did in
//      January.
//   3. **One event awards once**, however many times the bus delivers it.
//   4. **Nothing moves backwards.** A rule can advance somebody and can never
//      demote them.
//   5. **Deleting a rule leaves the points it gave**, so nobody's history is
//      quietly rewritten.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { users } from "@/core/auth/schema";
import { contacts } from "@/core/contacts/schema";
import { contactScoreAwards, scoringRules } from "@/core/scoring/schema";
import { db } from "@/core/db";
import { ready } from "@/core/runtime";
import { getService } from "@/core/service";
import {
  awardPoints,
  explainScore,
  listScoringRules,
  remainingPoints,
  removeScoringRule,
  saveScoringRule,
  scoreEvent,
  scoreFor,
} from "@/core/scoring/service";
import { closeDb, failure, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

describe("what an award is worth today", () => {
  const day = 86_400_000;

  it("is worth all of it when nothing fades", () => {
    expect(remainingPoints(10, 0, new Date(0), new Date(1_000 * day))).toBe(10);
  });

  // Linear rather than a cliff: a score that drops overnight for a reason
  // nobody witnessed is a score nobody trusts.
  it("fades in a straight line to nothing", () => {
    const now = new Date(100 * day);
    const halfway = new Date(now.getTime() - 15 * day);
    expect(remainingPoints(10, 30, halfway, now)).toBe(5);
    const nearlyGone = new Date(now.getTime() - 27 * day);
    expect(remainingPoints(10, 30, nearlyGone, now)).toBe(1);
    const gone = new Date(now.getTime() - 31 * day);
    expect(remainingPoints(10, 30, gone, now)).toBe(0);
  });

  it("fades a penalty the same way it fades a reward", () => {
    const now = new Date(100 * day);
    const halfway = new Date(now.getTime() - 15 * day);
    expect(remainingPoints(-10, 30, halfway, now)).toBe(-5);
  });
});

describe.runIf(hasDatabase)("scoring", { timeout: 90_000 }, () => {
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

  async function contactId(email = "rae@example.test"): Promise<string> {
    const resolved = (await getService("contacts.resolve").call(
      { email, name: "Rae Lane", source: "test" },
      { kind: "system" },
    )) as { contact: { id: string } };
    return resolved.contact.id;
  }

  async function rule(overrides: Record<string, unknown> = {}) {
    return saveScoringRule.call(
      {
        name: "Viewed pricing",
        kind: "event",
        eventName: "page.viewed",
        points: 10,
        ...overrides,
      },
      OWNER,
    );
  }

  it("refuses a rule that can never fire", async () => {
    const noEvent = await failure(
      saveScoringRule.call({ name: "Nothing", kind: "event", points: 5 }, OWNER),
    );
    expect(noEvent.message).toContain("which event");

    const noStage = await failure(
      saveScoringRule.call(
        { name: "Hot", kind: "threshold", thresholdScore: 50 },
        OWNER,
      ),
    );
    expect(noStage.message).toContain("where somebody goes");
  });

  it("awards points when the event it listens for happens", async () => {
    const someone = await contactId();
    await rule();
    const result = await scoreEvent("page.viewed", { contactId: someone }, "evt-1");
    expect(result.awarded).toBe(1);
    expect(await scoreFor.call({ contactId: someone }, OWNER)).toEqual({ score: 10 });
  });

  it("ignores an event that is not about anybody", async () => {
    await rule();
    // No contact id: scoring guesses at nothing, because a guess here awards
    // points to the wrong record.
    expect(await scoreEvent("page.viewed", { path: "/pricing" }, "evt-1")).toEqual({
      awarded: 0,
    });
    expect(await db().select().from(contactScoreAwards)).toHaveLength(0);
  });

  // The bus retries. A retry that doubled a score would make the number
  // meaningless in exactly the way §4.14 forbids.
  it("awards once however often the bus delivers the same event", async () => {
    const someone = await contactId();
    await rule();
    await scoreEvent("page.viewed", { contactId: someone }, "evt-1");
    await scoreEvent("page.viewed", { contactId: someone }, "evt-1");
    expect(await db().select().from(contactScoreAwards)).toHaveLength(1);
    expect(await scoreFor.call({ contactId: someone }, OWNER)).toEqual({ score: 10 });
  });

  it("stops awarding once a rule has given all it may", async () => {
    const someone = await contactId();
    await rule({ maxAwards: 2 });
    await scoreEvent("page.viewed", { contactId: someone }, "evt-1");
    await scoreEvent("page.viewed", { contactId: someone }, "evt-2");
    await scoreEvent("page.viewed", { contactId: someone }, "evt-3");
    // Without a cap, one determined visitor becomes the hottest lead in the
    // business.
    expect(await scoreFor.call({ contactId: someone }, OWNER)).toEqual({ score: 20 });
  });

  it("only fires when the payload says what the rule asked about", async () => {
    const someone = await contactId();
    await rule({ name: "Site quotes", eventName: "quote.sent", matchPayload: { source: "site" } });
    await scoreEvent("quote.sent", { contactId: someone, source: "admin" }, "evt-1");
    expect(await scoreFor.call({ contactId: someone }, OWNER)).toEqual({ score: 0 });
    await scoreEvent("quote.sent", { contactId: someone, source: "site" }, "evt-2");
    expect(await scoreFor.call({ contactId: someone }, OWNER)).toEqual({ score: 10 });
  });

  it("does not fire on a payload that is silent about the condition", async () => {
    const someone = await contactId();
    await rule({ eventName: "quote.sent", matchPayload: { source: "site" } });
    // The safe direction: the alternative gives points for something nobody can
    // show happened.
    await scoreEvent("quote.sent", { contactId: someone }, "evt-1");
    expect(await scoreFor.call({ contactId: someone }, OWNER)).toEqual({ score: 0 });
  });

  it("leaves an inactive rule alone", async () => {
    const someone = await contactId();
    await rule({ active: false });
    await scoreEvent("page.viewed", { contactId: someone }, "evt-1");
    expect(await scoreFor.call({ contactId: someone }, OWNER)).toEqual({ score: 0 });
  });

  // The sentence §4.14 asks for, answered by listing rows.
  it("says why somebody is the number they are, and the rows add up", async () => {
    const someone = await contactId();
    await rule({ name: "Viewed pricing", points: 10 });
    await rule({ name: "Opened an email", eventName: "email.opened", points: 5 });
    await scoreEvent("page.viewed", { contactId: someone }, "evt-1");
    await scoreEvent("email.opened", { contactId: someone }, "evt-2");

    const why = await explainScore.call({ contactId: someone }, OWNER);
    expect(why.score).toBe(15);
    expect(why.awards.map((award) => award.ruleName).sort()).toEqual([
      "Opened an email",
      "Viewed pricing",
    ]);
    // The listed rows are the total, so the arithmetic on screen adds up.
    expect(why.awards.reduce((sum, award) => sum + award.remaining, 0)).toBe(why.score);
  });

  it("counts a faded award at what is left of it", async () => {
    const someone = await contactId();
    await rule({ decayDays: 30 });
    await scoreEvent("page.viewed", { contactId: someone }, "evt-1");
    // Backdate the award to halfway through its life.
    await db()
      .update(contactScoreAwards)
      .set({ occurredAt: new Date(Date.now() - 15 * 86_400_000) });

    expect(await scoreFor.call({ contactId: someone }, OWNER)).toEqual({ score: 5 });
    const why = await explainScore.call({ contactId: someone }, OWNER);
    expect(why.awards[0]).toMatchObject({ points: 10, remaining: 5, decayDays: 30 });
    expect(why.awards[0]!.daysLeft).toBe(15);
  });

  it("drops an award to nothing once its time is up", async () => {
    const someone = await contactId();
    await rule({ decayDays: 7 });
    await scoreEvent("page.viewed", { contactId: someone }, "evt-1");
    await db()
      .update(contactScoreAwards)
      .set({ occurredAt: new Date(Date.now() - 30 * 86_400_000) });
    expect(await scoreFor.call({ contactId: someone }, OWNER)).toEqual({ score: 0 });
  });

  // Lowering a rule changes what future behaviour is worth, not what somebody
  // already did.
  it("does not rewrite what a past award was worth when the rule changes", async () => {
    const someone = await contactId();
    const existing = await rule({ points: 20 });
    await scoreEvent("page.viewed", { contactId: someone }, "evt-1");
    await saveScoringRule.call(
      { id: existing.id, name: existing.name, kind: "event", eventName: "page.viewed", points: 5 },
      OWNER,
    );
    expect(await scoreFor.call({ contactId: someone }, OWNER)).toEqual({ score: 20 });
    await scoreEvent("page.viewed", { contactId: someone }, "evt-2");
    expect(await scoreFor.call({ contactId: someone }, OWNER)).toEqual({ score: 25 });
  });

  it("keeps the points a deleted rule gave, and what it was called", async () => {
    const someone = await contactId();
    const existing = await rule({ name: "Viewed pricing" });
    await scoreEvent("page.viewed", { contactId: someone }, "evt-1");
    await removeScoringRule.call({ id: existing.id }, OWNER);

    const why = await explainScore.call({ contactId: someone }, OWNER);
    expect(why.score).toBe(10);
    // Still a sentence, rather than a blank.
    expect(why.awards[0]!.ruleName).toBe("Viewed pricing");
    expect(await listScoringRules.call({}, OWNER)).toHaveLength(0);
  });

  it("moves somebody along when a rule says to", async () => {
    const someone = await contactId();
    await rule({ eventName: "quote.accepted", points: 30, advanceTo: "customer" });
    await scoreEvent("quote.accepted", { contactId: someone }, "evt-1");
    const [after] = await db().select().from(contacts).where(eq(contacts.id, someone));
    expect(after!.lifecycleStage).toBe("customer");
  });

  it("never moves somebody backwards", async () => {
    const someone = await contactId();
    await db()
      .update(contacts)
      .set({ lifecycleStage: "customer" })
      .where(eq(contacts.id, someone));
    await rule({ eventName: "email.opened", points: 1, advanceTo: "lead" });
    await scoreEvent("email.opened", { contactId: someone }, "evt-1");
    const [after] = await db().select().from(contacts).where(eq(contacts.id, someone));
    // Opening an email must not demote a customer.
    expect(after!.lifecycleStage).toBe("customer");
  });

  it("moves somebody along when their score crosses a line", async () => {
    const someone = await contactId();
    await saveScoringRule.call(
      { name: "Worth calling", kind: "threshold", thresholdScore: 25, advanceTo: "prospect" },
      OWNER,
    );
    await rule({ points: 10 });

    await scoreEvent("page.viewed", { contactId: someone }, "evt-1");
    let [row] = await db().select().from(contacts).where(eq(contacts.id, someone));
    expect(row!.lifecycleStage).toBe("lead");

    await scoreEvent("page.viewed", { contactId: someone }, "evt-2");
    await scoreEvent("page.viewed", { contactId: someone }, "evt-3");
    [row] = await db().select().from(contacts).where(eq(contacts.id, someone));
    // 30 crosses 25.
    expect(row!.lifecycleStage).toBe("prospect");
  });

  // The seam C7.01 made necessary: the board and the spine enum must not fork.
  // Core cannot import the CRM module, so the CRM registers how this instance
  // moves people and core asks whatever is registered.
  it("moves somebody through the board when there is one", async () => {
    const { contactStages, pipelineStages } = await import("@/modules/crm/schema");
    const { installPipelineDefaults } = await import("@/modules/crm/service");
    await installPipelineDefaults.call({}, OWNER);

    const someone = await contactId();
    await rule({ eventName: "quote.accepted", points: 30, advanceTo: "customer" });
    await scoreEvent("quote.accepted", { contactId: someone }, "evt-1");

    const [coarse] = await db().select().from(contacts).where(eq(contacts.id, someone));
    expect(coarse!.lifecycleStage).toBe("customer");

    // And the owner's own stage moved with it, rather than being left stale.
    const [fine] = await db()
      .select({ name: pipelineStages.name, derives: pipelineStages.lifecycleStage })
      .from(contactStages)
      .innerJoin(pipelineStages, eq(pipelineStages.id, contactStages.stageId))
      .where(eq(contactStages.contactId, someone));
    expect(fine).toMatchObject({ derives: "customer" });
  });

  it("takes points by hand, on the record", async () => {
    const someone = await contactId();
    const given = await awardPoints.call(
      { contactId: someone, reason: "Rang us about the extension", points: 20 },
      OWNER,
    );
    expect(given.score).toBe(20);
    const why = await explainScore.call({ contactId: someone }, OWNER);
    // As inspectable as anything a rule gave: same ledger, same shape.
    expect(why.awards[0]).toMatchObject({
      ruleName: "Rang us about the extension",
      eventName: "manual",
      points: 20,
    });
  });

  it("adds the two ledgers together when two records become one", async () => {
    const survivor = await contactId("keep@example.test");
    const duplicate = await contactId("keep.dup@example.test");
    await rule();
    await scoreEvent("page.viewed", { contactId: survivor }, "evt-1");
    await scoreEvent("page.viewed", { contactId: duplicate }, "evt-2");

    await getService("contacts.merge").call(
      { survivingId: survivor, duplicateId: duplicate },
      OWNER,
    );
    // They genuinely did both things, under two addresses nobody had connected.
    expect(await scoreFor.call({ contactId: survivor }, OWNER)).toEqual({ score: 20 });
  });

  it("forgets what somebody did when they are erased", async () => {
    const someone = await contactId();
    await rule();
    await scoreEvent("page.viewed", { contactId: someone }, "evt-1");

    const { contactPrivacySources } = await import("@/core/privacy/service");
    const source = contactPrivacySources().find((one) => one.scope === "contact.score");
    expect(source).toBeTruthy();
    await db().transaction((tx) => source!.erase(tx, someone, { requestId: "t" }));

    // A score is a behavioural profile, which is about as personal as data
    // gets; keeping the ledger would keep the profile.
    expect(await db().select().from(contactScoreAwards)).toHaveLength(0);
    expect(await db().select().from(scoringRules)).toHaveLength(1);
  });
});
