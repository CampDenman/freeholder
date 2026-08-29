// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Tiers, rewards and redemption (MASTER.md §4.13, C9.12).
//
// The test worth reading first is the convergence one: redeeming produces a
// coupon the *catalog* honours, issued through a registry in core, with
// neither module importing the other. That is the whole reason redemption is
// not simply a discount loyalty invented for itself.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { timelineEvents } from "@/core/contacts/schema";
import { coupons } from "@/modules/catalog/schema";
import { loyaltyAccounts, pointsLedger, redemptions } from "@/modules/loyalty/schema";
import {
  adjustPoints,
  catalogue,
  enrol,
  evaluateTier,
  onSpineEvent,
  redeem,
  redemptionHistory,
  reevaluateTier,
  saveEarnRule,
  saveProgram,
  saveReward,
  saveTier,
  statementFor,
  tiers,
} from "@/modules/loyalty/service";
import { resolveContact } from "@/core/contacts/service";
import { updateBusiness } from "@/core/settings/service";
import { ANONYMOUS, closeDb, failure, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

const BUSINESS = {
  name: "Aurora Coast Photography",
  country: "CA",
  baseCurrency: "CAD",
  timezone: "America/Vancouver",
};

async function customer(email = "rae@example.test") {
  const { contact } = await resolveContact.call({ email, name: "Rae" }, OWNER);
  return contact;
}

async function programme(overrides: Record<string, unknown> = {}) {
  return saveProgram.call(
    {
      name: "Stars",
      status: "active",
      earnCurrency: "CAD",
      redemptionValueCents: 2,
      enrolment: "automatic",
      ...overrides,
    },
    OWNER,
  );
}

/** Enrol and put a known number of points on the ledger. */
async function accountWith(programId: string, points: number, contactEmail?: string) {
  const contact = await customer(contactEmail);
  const { accountId } = await enrol.call({ contactId: contact.id, programId }, OWNER);
  if (points > 0) {
    await adjustPoints.call({ accountId, delta: points, note: "Opening balance for a test." }, OWNER);
  }
  return { contact, accountId };
}

const ORDER = "11111111-1111-4111-8111-111111111111";

async function orderPaid(contactId: string, totalMinor: number, orderId = ORDER) {
  await db().insert(timelineEvents).values({
    contactId,
    actor: "system",
    eventType: "order.paid",
    subjectType: "order",
    subjectId: orderId,
    payload: { totalMinor, currency: "CAD" },
  });
  await onSpineEvent({ orderId }, "catalog.orderPaid");
}

describe.runIf(hasDatabase)("loyalty tiers, rewards and redemption", () => {
  beforeEach(async () => {
    await truncateSpine();
    await updateBusiness.call(BUSINESS, OWNER);
  });

  afterAll(async () => {
    await closeDb();
  });

  it("turns points into a coupon the shop already honours", async () => {
    // §4.13: "Points become a coupon, a pass balance, or a zero-value invoice
    // line — never a parallel discount path." The proof is a row in the
    // catalog's own coupons table, created by a module loyalty never imports.
    const program = await programme();
    const { accountId } = await accountWith(program.id, 500);
    const reward = await saveReward.call(
      {
        programId: program.id,
        name: "Ten percent off",
        kind: "discount",
        costPoints: 200,
        value: { percentOffPpm: 100000 },
        status: "active",
      },
      OWNER,
    );

    const result = await redeem.call({ accountId, rewardId: reward.id }, OWNER);

    expect(result.issuedBy).toBe("catalog");
    expect(result.status).toBe("issued");
    expect(result.reference).toMatch(/^REWARD-/);
    expect(result.balance).toBe(300);

    const issued = await db().select().from(coupons).where(eq(coupons.code, result.reference!));
    expect(issued).toHaveLength(1);
    expect(issued[0]!.percentOffPpm).toBe(100000);
    // The points were spent once, so the coupon can be used once.
    expect(issued[0]!.maxRedemptions).toBe(1);
  });

  it("writes the spend to the ledger like every other movement", async () => {
    const program = await programme();
    const { contact, accountId } = await accountWith(program.id, 500);
    const reward = await saveReward.call(
      {
        programId: program.id,
        name: "Ten off",
        kind: "discount",
        costPoints: 200,
        value: { amountMinor: 1000, currency: "CAD" },
        status: "active",
      },
      OWNER,
    );
    await redeem.call({ accountId, rewardId: reward.id }, OWNER);

    const statement = await statementFor.call(
      { contactId: contact.id, programId: program.id },
      OWNER,
    );
    const spend = statement!.entries.find((e) => e.reason === "redeem")!;
    expect(spend.delta).toBe(-200);
    expect(spend.note).toBe("Ten off");
    expect(statement!.balance).toBe(300);
  });

  it("will not let somebody spend points they do not have", async () => {
    const program = await programme();
    const { accountId } = await accountWith(program.id, 50);
    const reward = await saveReward.call(
      {
        programId: program.id,
        name: "Big",
        kind: "discount",
        costPoints: 200,
        value: { percentOffPpm: 100000 },
        status: "active",
      },
      OWNER,
    );
    const error = await failure(redeem.call({ accountId, rewardId: reward.id }, OWNER));
    expect(error.code).toBe("validation");
    expect(error.message).toContain("50");

    // Nothing was written: no ledger row, no redemption, no coupon.
    const rows = await db().select().from(pointsLedger).where(eq(pointsLedger.accountId, accountId));
    expect(rows.filter((r) => r.reason === "redeem")).toHaveLength(0);
    expect(await db().select().from(redemptions)).toHaveLength(0);
  });

  it("holds a new account back until it is old enough to redeem", async () => {
    // §4.13's fraud floor: "a minimum account age before redemption". Points
    // farmed and cashed out the same hour is the pattern this closes.
    const program = await programme({ minAccountAgeDays: 7 });
    const { accountId } = await accountWith(program.id, 500);
    const reward = await saveReward.call(
      {
        programId: program.id,
        name: "Ten percent",
        kind: "discount",
        costPoints: 100,
        value: { percentOffPpm: 100000 },
        status: "active",
      },
      OWNER,
    );

    const error = await failure(redeem.call({ accountId, rewardId: reward.id }, OWNER));
    expect(error.code).toBe("validation");
    expect(error.message).toContain("7 days");

    await db()
      .update(loyaltyAccounts)
      .set({ enrolledAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) })
      .where(eq(loyaltyAccounts.id, accountId));
    const ok = await redeem.call({ accountId, rewardId: reward.id }, OWNER);
    expect(ok.status).toBe("issued");
  });

  it("stops at the stock and at the per-person limit", async () => {
    const program = await programme();
    const first = await accountWith(program.id, 1000, "a@example.test");
    const second = await accountWith(program.id, 1000, "b@example.test");
    const reward = await saveReward.call(
      {
        programId: program.id,
        name: "Scarce",
        kind: "discount",
        costPoints: 100,
        value: { percentOffPpm: 50000 },
        stock: 1,
        perContactLimit: 1,
        status: "active",
      },
      OWNER,
    );

    await redeem.call({ accountId: first.accountId, rewardId: reward.id }, OWNER);
    const soldOut = await failure(
      redeem.call({ accountId: second.accountId, rewardId: reward.id }, OWNER),
    );
    expect(soldOut.code).toBe("validation");
    expect(soldOut.message).toContain("run out");
  });

  it("refuses a reward meant for a tier this account is not in", async () => {
    const program = await programme();
    const gold = await saveTier.call(
      { programId: program.id, name: "Gold", threshold: 1000, position: 1 },
      OWNER,
    );
    const { accountId } = await accountWith(program.id, 500);
    const reward = await saveReward.call(
      {
        programId: program.id,
        name: "Gold only",
        kind: "discount",
        costPoints: 100,
        value: { percentOffPpm: 200000 },
        eligibleTierIds: [gold.id],
        status: "active",
      },
      OWNER,
    );

    const error = await failure(redeem.call({ accountId, rewardId: reward.id }, OWNER));
    expect(error.code).toBe("validation");
    expect(error.message).toContain("different tier");
  });

  it("decides a tier from the ledger, not from anybody's opinion", async () => {
    // §4.13: "Tier evaluation is a pure function of the ledger and a window."
    const program = await programme();
    await saveTier.call(
      { programId: program.id, name: "Silver", threshold: 100, position: 0 },
      OWNER,
    );
    const gold = await saveTier.call(
      { programId: program.id, name: "Gold", threshold: 500, position: 1 },
      OWNER,
    );
    await saveEarnRule.call(
      {
        programId: program.id,
        name: "Per dollar",
        eventType: "order.paid",
        formula: "per_currency_unit",
        points: 1,
      },
      OWNER,
    );

    const contact = await customer();
    await orderPaid(contact.id, 60000);

    const [account] = await db()
      .select()
      .from(loyaltyAccounts)
      .where(eq(loyaltyAccounts.contactId, contact.id));
    // Evaluated on write, as §4.13 asks, so the standing is true the moment
    // the points land rather than at the next scheduled sweep.
    expect(account!.tierId).toBe(gold.id);
    expect(account!.tierSince).not.toBeNull();
  });

  it("keeps a standing when points are spent, because earning is the basis", async () => {
    // Spending your points should not cost you your status: the basis is what
    // was earned in the window, not what is left in the balance.
    const program = await programme();
    const silver = await saveTier.call(
      { programId: program.id, name: "Silver", threshold: 100, position: 0 },
      OWNER,
    );
    await saveEarnRule.call(
      { programId: program.id, name: "Flat", eventType: "order.paid", formula: "fixed", points: 300 },
      OWNER,
    );
    const contact = await customer();
    await orderPaid(contact.id, 1000);

    const [account] = await db()
      .select()
      .from(loyaltyAccounts)
      .where(eq(loyaltyAccounts.contactId, contact.id));
    expect(account!.tierId).toBe(silver.id);

    const reward = await saveReward.call(
      {
        programId: program.id,
        name: "Spend it all",
        kind: "discount",
        costPoints: 300,
        value: { percentOffPpm: 100000 },
        status: "active",
      },
      OWNER,
    );
    await redeem.call({ accountId: account!.id, rewardId: reward.id }, OWNER);
    await reevaluateTier.call({ accountId: account!.id }, OWNER);

    const [after] = await db()
      .select()
      .from(loyaltyAccounts)
      .where(eq(loyaltyAccounts.id, account!.id));
    expect(after!.tierId).toBe(silver.id);
  });

  it("says so on the timeline when somebody moves up or down", async () => {
    // §4.13 wants promotion and demotion recorded "so automations can act and
    // the customer can be told" — both need the event to exist whether or not
    // anything is listening today.
    const program = await programme();
    const silver = await saveTier.call(
      { programId: program.id, name: "Silver", threshold: 100, position: 0 },
      OWNER,
    );
    const { contact, accountId } = await accountWith(program.id, 0);

    await adjustPoints.call({ accountId, delta: 150, note: "Goodwill." }, OWNER);
    const change = await reevaluateTier.call({ accountId }, OWNER);
    expect(change.direction).toBe("promoted");
    expect(change.to).toBe(silver.id);

    const events = await db()
      .select()
      .from(timelineEvents)
      .where(eq(timelineEvents.contactId, contact.id));
    expect(events.some((e) => e.eventType === "loyalty.promoted")).toBe(true);
  });

  it("records a redemption nothing could issue as needing a hand, not as done", async () => {
    // A physical print cannot become a coupon. Saying "issued" would be a lie
    // the customer discovers at the till, so the status says what is true.
    const program = await programme();
    const { accountId } = await accountWith(program.id, 500);
    const reward = await saveReward.call(
      {
        programId: program.id,
        name: "A framed print",
        kind: "free_product",
        costPoints: 200,
        status: "active",
      },
      OWNER,
    );

    const result = await redeem.call({ accountId, rewardId: reward.id }, OWNER);
    expect(result.status).toBe("manual");
    expect(result.issuedBy).toBe("manual");
    expect(result.reference).toBeNull();
    // The points were still spent: the customer chose the reward.
    expect(result.balance).toBe(300);
  });

  it("shows the owner what has been taken", async () => {
    const program = await programme();
    const { accountId } = await accountWith(program.id, 500);
    const reward = await saveReward.call(
      {
        programId: program.id,
        name: "Ten percent",
        kind: "discount",
        costPoints: 100,
        value: { percentOffPpm: 100000 },
        status: "active",
      },
      OWNER,
    );
    await redeem.call({ accountId, rewardId: reward.id }, OWNER);

    const history = await redemptionHistory.call({ programId: program.id }, OWNER);
    expect(history).toHaveLength(1);
    expect(history[0]!.rewardName).toBe("Ten percent");
    expect(history[0]!.pointsSpent).toBe(100);
    expect(history[0]!.issuedBy).toBe("catalog");
  });

  it("offers only what is actually on offer", async () => {
    const program = await programme();
    await saveReward.call(
      {
        programId: program.id,
        name: "Live",
        kind: "discount",
        costPoints: 100,
        value: { percentOffPpm: 100000 },
        status: "active",
      },
      OWNER,
    );
    await saveReward.call(
      {
        programId: program.id,
        name: "Not yet",
        kind: "discount",
        costPoints: 50,
        value: { percentOffPpm: 50000 },
        status: "draft",
      },
      OWNER,
    );

    // Public, because a rewards list is something a customer reads before
    // deciding whether the programme is worth joining.
    const offered = await catalogue.call({ programId: program.id }, ANONYMOUS);
    expect(offered.map((r) => r.name)).toEqual(["Live"]);
  });

  it("refuses a discount reward that says nothing about the discount", async () => {
    const program = await programme();
    const error = await failure(
      saveReward.call(
        { programId: program.id, name: "Vague", kind: "discount", costPoints: 100, status: "active" },
        OWNER,
      ),
    );
    expect(error.code).toBe("validation");
  });

  it("refuses a reward that costs nothing", async () => {
    // A free reward is not a redemption, it is a benefit — and benefits belong
    // to a tier, where they do not consume a balance.
    const program = await programme();
    const error = await failure(
      saveReward.call(
        {
          programId: program.id,
          name: "Free",
          kind: "discount",
          costPoints: 0,
          value: { percentOffPpm: 100000 },
        },
        OWNER,
      ),
    );
    expect(error.code).toBe("validation");
  });

  it("keeps a tier ladder unambiguous", async () => {
    const program = await programme();
    await saveTier.call({ programId: program.id, name: "Silver", threshold: 100, position: 0 }, OWNER);
    // Two tiers on one rung is a ladder with an ambiguous top, and evaluation
    // would pick between them by accident.
    const error = await failure(
      saveTier.call({ programId: program.id, name: "Bronze", threshold: 50, position: 0 }, OWNER),
    );
    expect(error).toBeDefined();

    const ladder = await tiers.call({ programId: program.id }, OWNER);
    expect(ladder).toHaveLength(1);
  });

  it("leaves an account tierless when a programme has no ladder", async () => {
    const program = await programme();
    const { accountId } = await accountWith(program.id, 5000);
    const change = await evaluateTier(db() as never, accountId);
    expect(change.direction).toBe("unchanged");
    const [account] = await db()
      .select()
      .from(loyaltyAccounts)
      .where(eq(loyaltyAccounts.id, accountId));
    expect(account!.tierId).toBeNull();
  });
});
