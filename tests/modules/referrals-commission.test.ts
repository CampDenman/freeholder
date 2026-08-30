// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Commission, holdbacks, reversal and payouts (MASTER.md §4.3, §4.13, C9.10).
//
// The tests worth reading first are the ones about money that must not appear
// or disappear: that splitting a commission between referrers sums to exactly
// what was earned, that a refund inside the holdback reverses but a refund
// after payout writes a negative row instead, and that a referrer's own
// referrer earns nothing — §4.13's "one hop only", which the data model is
// supposed to refuse rather than the policy.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { db } from "@/core/db";
import { timelineEvents } from "@/core/contacts/schema";
import {
  commissionEvents,
  payoutBatches,
  payoutLines,
} from "@/modules/referrals/schema";
import {
  approveBatch,
  attributionFor,
  batchCsv,
  buildBatch,
  commissions,
  issueCode,
  markBatchPaid,
  onSpineEvent,
  recordTouch,
  saveProgram,
  saveTaxProfile,
  taxPrompts,
} from "@/modules/referrals/service";
import { matureCommissions } from "@/modules/referrals/service";
import {
  commissionFor,
  PPM,
  payableAt,
  sharesFrom,
  splitMinor,
} from "@/modules/referrals/commission";
import { resolveContact } from "@/core/contacts/service";
import { updateBusiness } from "@/core/settings/service";
import { closeDb, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

/* ------------------------------------------------------------ arithmetic */

// No database. These are the numbers a referrer disputes, and they have to be
// answerable without one.
describe("what a conversion is worth", () => {
  it("takes a percentage in parts per million", () => {
    // 10% of £100.00 is £10.00.
    expect(commissionFor({ kind: "percent", value: 100_000 }, 10_000)).toBe(1_000);
  });

  it("rounds half up, so the same input never gives two answers", () => {
    // 12.5 minor units, twice, is 13 both times.
    expect(commissionFor({ kind: "percent", value: 500_000 }, 25)).toBe(13);
    expect(commissionFor({ kind: "percent", value: 500_000 }, 25)).toBe(13);
  });

  it("pays a fixed amount regardless of the basis", () => {
    expect(commissionFor({ kind: "fixed", value: 500 }, 10_000)).toBe(500);
  });

  it("honours a cap", () => {
    expect(commissionFor({ kind: "percent", value: 500_000, capMinor: 200 }, 10_000)).toBe(200);
  });

  it("never pays more than the sale was worth", () => {
    // A fixed commission larger than a small order is a configuration
    // mistake, not a deal, and it must not reach a payout batch.
    expect(commissionFor({ kind: "fixed", value: 5_000 }, 300)).toBe(300);
  });

  it("pays nothing when the programme pays in points", () => {
    // "none" is a real setting: the referrer is paid through a loyalty earn
    // rule matching `referral.converted`, and no cash row belongs here.
    expect(commissionFor({ kind: "none" }, 10_000)).toBe(0);
    expect(commissionFor({}, 10_000)).toBe(0);
  });
});

describe("dividing it between referrers", () => {
  it("turns fractional credits into shares that sum to exactly one", () => {
    const shares = sharesFrom([
      { codeId: "a", share: 1 / 3 },
      { codeId: "b", share: 1 / 3 },
      { codeId: "c", share: 1 / 3 },
    ]);
    expect(shares.reduce((sum, share) => sum + share.sharePpm, 0)).toBe(PPM);
  });

  it("splits money so the parts are exactly the whole, for every amount", () => {
    // The property that matters. Rounding each share independently loses a
    // penny on most amounts and gains one on some, and over a year that is a
    // discrepancy somebody has to chase.
    const shares = sharesFrom([
      { codeId: "a", share: 0.4 },
      { codeId: "b", share: 0.2 },
      { codeId: "c", share: 0.4 },
    ]);
    for (let total = 0; total <= 500; total += 1) {
      const parts = splitMinor(total, shares);
      expect(parts.reduce((sum, part) => sum + part.amountMinor, 0)).toBe(total);
    }
  });

  it("splits a negative clawback without inventing a unit either", () => {
    const shares = sharesFrom([
      { codeId: "a", share: 1 / 3 },
      { codeId: "b", share: 2 / 3 },
    ]);
    for (let total = -1; total >= -200; total -= 1) {
      const parts = splitMinor(total, shares);
      expect(parts.reduce((sum, part) => sum + part.amountMinor, 0)).toBe(total);
    }
  });

  it("is stable: the same conversion divides the same way twice", () => {
    const credits = [
      { codeId: "zzz", share: 1 / 3 },
      { codeId: "aaa", share: 1 / 3 },
      { codeId: "mmm", share: 1 / 3 },
    ];
    expect(sharesFrom(credits)).toEqual(sharesFrom(credits));
  });
});

describe("the holdback", () => {
  it("is the stated number of days after the conversion", () => {
    const earned = new Date("2026-03-01T00:00:00.000Z");
    expect(payableAt(earned, 30).toISOString()).toBe("2026-03-31T00:00:00.000Z");
  });

  it("is immediate when a programme holds nothing back", () => {
    const earned = new Date("2026-03-01T00:00:00.000Z");
    expect(payableAt(earned, 0).getTime()).toBe(earned.getTime());
  });
});

/* --------------------------------------------------------------- the rest */

const BUSINESS = {
  name: "Aurora Coast Photography",
  country: "CA",
  baseCurrency: "CAD",
  timezone: "America/Vancouver",
};

const INVOICE = "22222222-2222-4222-8222-222222222222";

async function contact(email: string, name = "Rae") {
  const { contact: found } = await resolveContact.call({ email, name }, OWNER);
  return found;
}

async function programme(overrides: Record<string, unknown> = {}) {
  return saveProgram.call(
    {
      name: "Word of mouth",
      status: "active",
      cookieWindowDays: 30,
      holdbackDays: 30,
      commission: { kind: "percent", value: 100_000 },
      ...overrides,
    },
    OWNER,
  );
}

/** The spine row an emitting mutation would have written, then the bus event. */
async function invoicePaid(opts: {
  contactId: string;
  totalMinor: number;
  invoiceId?: string;
  sourceType?: string;
}) {
  const invoiceId = opts.invoiceId ?? INVOICE;
  await db().insert(timelineEvents).values({
    contactId: opts.contactId,
    actor: "system",
    eventType: "invoice.paid",
    subjectType: "invoice",
    subjectId: invoiceId,
    payload: {
      totalMinor: opts.totalMinor,
      currency: "CAD",
      sourceType: opts.sourceType ?? "order",
    },
  });
  await onSpineEvent({ invoiceId }, "invoice.paid");
  return invoiceId;
}

async function invoiceRefunded(contactId: string, invoiceId = INVOICE) {
  await db().insert(timelineEvents).values({
    contactId,
    actor: "system",
    eventType: "invoice.refunded",
    subjectType: "invoice",
    subjectId: invoiceId,
    payload: { totalMinor: 0, currency: "CAD" },
  });
  await onSpineEvent({ invoiceId }, "invoice.refunded");
}

/**
 * Let the holdback close, the way the daily job does.
 *
 * The job calls the same function; there is no service in between, because a
 * `permission: "system"` service is a reviewed entry on an explicit inventory
 * and this needed no caller outside the job.
 */
async function mature(): Promise<number> {
  let approved = 0;
  await db().transaction(async (tx) => {
    approved = await matureCommissions(tx);
  });
  return approved;
}

/** A referrer with a code, and a customer who arrived through it. */
async function referredSale(opts: { totalMinor: number; programOverrides?: Record<string, unknown> }) {
  const program = await programme(opts.programOverrides);
  const referrer = await contact("referrer@example.com", "Ines");
  const buyer = await contact("buyer@example.com", "Otto");
  const code = await issueCode.call(
    { programId: program.id, contactId: referrer.id, code: "INES" },
    OWNER,
  );
  await recordTouch.call(
    { code: "INES", contactId: buyer.id, kind: "click" },
    OWNER,
  );
  await invoicePaid({ contactId: buyer.id, totalMinor: opts.totalMinor });
  return { program, referrer, buyer, code };
}

describe.runIf(hasDatabase)("commission, holdbacks and payouts", () => {
  beforeEach(async () => {
    await truncateSpine();
    await updateBusiness.call(BUSINESS, OWNER);
  });

  afterAll(async () => {
    await closeDb();
  });

  it("writes a commission when a referred customer's invoice is paid", async () => {
    const { referrer } = await referredSale({ totalMinor: 10_000 });
    const earned = await commissions.call({ affiliateContactId: referrer.id }, OWNER);
    expect(earned).toHaveLength(1);
    expect(earned[0]!.amountMinor).toBe(1_000);
    expect(earned[0]!.status).toBe("pending");
    expect(earned[0]!.conversionType).toBe("order");
  });

  it("holds it back: nothing is payable until the refund window closes", async () => {
    await referredSale({ totalMinor: 10_000 });
    // The holdback has not elapsed, so maturing approves nothing.
    expect(await mature()).toBe(0);

    const [event] = await db().select().from(commissionEvents);
    expect(event!.status).toBe("pending");
    expect(event!.payableAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("approves it once the window has passed", async () => {
    await referredSale({ totalMinor: 10_000, programOverrides: { holdbackDays: 0 } });
    expect(await mature()).toBe(1);
    const [event] = await db().select().from(commissionEvents);
    expect(event!.status).toBe("approved");
  });

  it("does not pay twice when the bus redelivers the same conversion", async () => {
    const { buyer } = await referredSale({ totalMinor: 10_000 });
    // The outbox retries. The unique index is what makes that safe.
    await onSpineEvent({ invoiceId: INVOICE }, "invoice.paid");
    void buyer;
    expect(await db().select().from(commissionEvents)).toHaveLength(1);
  });

  it("pays nobody for their own purchase", async () => {
    const program = await programme();
    const person = await contact("both@example.com", "Sam");
    await issueCode.call({ programId: program.id, contactId: person.id, code: "SAM" }, OWNER);
    await recordTouch.call({ code: "SAM", contactId: person.id, kind: "manual" }, OWNER);
    await invoicePaid({ contactId: person.id, totalMinor: 10_000 });
    expect(await db().select().from(commissionEvents)).toHaveLength(0);
  });

  it("refuses a second hop: a referrer's referrer earns nothing", async () => {
    // §4.13: "One hop only. Commission accrues to the referrer of the
    // converting customer and to nobody above them."
    const program = await programme();
    const top = await contact("top@example.com", "Tal");
    const middle = await contact("middle@example.com", "Mim");
    const buyer = await contact("buyer@example.com", "Otto");

    await issueCode.call({ programId: program.id, contactId: top.id, code: "TAL" }, OWNER);
    await issueCode.call({ programId: program.id, contactId: middle.id, code: "MIM" }, OWNER);

    // Tal referred Mim, and Mim referred the buyer.
    await recordTouch.call({ code: "TAL", contactId: middle.id, kind: "click" }, OWNER);
    await recordTouch.call({ code: "MIM", contactId: buyer.id, kind: "click" }, OWNER);
    await invoicePaid({ contactId: buyer.id, totalMinor: 10_000 });

    const rows = await db().select().from(commissionEvents);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.affiliateContactId).toBe(middle.id);
  });

  it("has no column that could name a referrer's referrer", async () => {
    // The structural half of the same rule: refused "by the data model, not by
    // policy". A later well-meaning change has to argue with this.
    const columns = getTableConfig(commissionEvents).columns.map((column) => column.name);
    expect(columns).not.toContain("parent_id");
    expect(columns).not.toContain("parent_code_id");
    expect(columns).not.toContain("upline_contact_id");
  });

  it("splits one sale between two referrers under position-based attribution", async () => {
    const program = await programme({ attributionModel: "position_based" });
    const first = await contact("first@example.com", "Fay");
    const last = await contact("last@example.com", "Lou");
    const buyer = await contact("buyer@example.com", "Otto");

    await issueCode.call({ programId: program.id, contactId: first.id, code: "FAY" }, OWNER);
    await issueCode.call({ programId: program.id, contactId: last.id, code: "LOU" }, OWNER);
    await recordTouch.call({ code: "FAY", contactId: buyer.id, kind: "click" }, OWNER);
    await recordTouch.call({ code: "LOU", contactId: buyer.id, kind: "click" }, OWNER);
    await invoicePaid({ contactId: buyer.id, totalMinor: 10_001 });

    const rows = await db().select().from(commissionEvents);
    expect(rows).toHaveLength(2);
    // Two touches split half each, and the parts are exactly the whole.
    const total = rows.reduce((sum, row) => sum + row.amountMinor, 0);
    expect(total).toBe(commissionFor({ kind: "percent", value: 100_000 }, 10_001));
  });

  it("reverses inside the holdback rather than clawing back", async () => {
    const { buyer } = await referredSale({ totalMinor: 10_000 });
    await invoiceRefunded(buyer.id);

    const rows = await db().select().from(commissionEvents);
    // One row, edited. Nothing was paid, so there is nothing to net off.
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("reversed");
  });

  it("writes a negative row when the refund lands after payout", async () => {
    // §4.13: "reversing after payout produces a negative line on the next
    // batch rather than an argument."
    const { buyer } = await referredSale({
      totalMinor: 10_000,
      programOverrides: { holdbackDays: 0 },
    });
    await mature();
    const built = await buildBatch.call(
      {
        periodStart: new Date(Date.now() - 86_400_000),
        periodEnd: new Date(Date.now() + 86_400_000),
        currency: "CAD",
      },
      OWNER,
    );
    await approveBatch.call({ batchId: built.batchId }, OWNER);
    await markBatchPaid.call({ batchId: built.batchId }, OWNER);

    await invoiceRefunded(buyer.id);

    const rows = await db().select().from(commissionEvents);
    expect(rows).toHaveLength(2);
    const original = rows.find((row) => row.reversesId === null)!;
    const clawback = rows.find((row) => row.reversesId !== null)!;
    // The original is untouched: it is the record of a payment that happened.
    expect(original.status).toBe("paid");
    expect(clawback.amountMinor).toBe(-original.amountMinor);
    expect(clawback.status).toBe("approved");
  });

  it("nets a clawback off the next batch instead of billing for it", async () => {
    const { referrer, buyer } = await referredSale({
      totalMinor: 10_000,
      programOverrides: { holdbackDays: 0 },
    });
    await mature();
    const first = await buildBatch.call(
      {
        periodStart: new Date(Date.now() - 86_400_000),
        periodEnd: new Date(Date.now() + 86_400_000),
        currency: "CAD",
      },
      OWNER,
    );
    await approveBatch.call({ batchId: first.batchId }, OWNER);
    await markBatchPaid.call({ batchId: first.batchId }, OWNER);
    await invoiceRefunded(buyer.id);

    // A second sale, larger, so the clawback nets off rather than going
    // negative — the humane reading of a netting rule.
    const second = "33333333-3333-4333-8333-333333333333";
    await invoicePaid({ contactId: buyer.id, totalMinor: 30_000, invoiceId: second });
    await mature();

    const batch = await buildBatch.call(
      {
        periodStart: new Date(Date.now() - 86_400_000),
        periodEnd: new Date(Date.now() + 86_400_000),
        currency: "CAD",
      },
      OWNER,
    );
    const [line] = await db()
      .select()
      .from(payoutLines)
      .where(eq(payoutLines.batchId, batch.batchId));
    // 3,000 earned less the 1,000 clawed back.
    expect(line!.amountMinor).toBe(2_000);
    expect(line!.affiliateContactId).toBe(referrer.id);
  });

  it("pays somebody with two codes once", async () => {
    const program = await programme({ holdbackDays: 0, attributionModel: "first_touch" });
    const referrer = await contact("referrer@example.com", "Ines");
    const one = await contact("one@example.com", "Ana");
    const two = await contact("two@example.com", "Bo");
    await issueCode.call({ programId: program.id, contactId: referrer.id, code: "CARD" }, OWNER);
    await issueCode.call({ programId: program.id, contactId: referrer.id, code: "POSTER" }, OWNER);
    await recordTouch.call({ code: "CARD", contactId: one.id, kind: "click" }, OWNER);
    await recordTouch.call({ code: "POSTER", contactId: two.id, kind: "scan" }, OWNER);
    await invoicePaid({ contactId: one.id, totalMinor: 10_000, invoiceId: INVOICE });
    await invoicePaid({
      contactId: two.id,
      totalMinor: 20_000,
      invoiceId: "44444444-4444-4444-8444-444444444444",
    });
    await mature();

    const batch = await buildBatch.call(
      {
        periodStart: new Date(Date.now() - 86_400_000),
        periodEnd: new Date(Date.now() + 86_400_000),
        currency: "CAD",
      },
      OWNER,
    );
    expect(batch.lines).toBe(1);
    expect(batch.totalMinor).toBe(3_000);
  });

  it("refuses to build a batch with nothing payable in it", async () => {
    await referredSale({ totalMinor: 10_000 });
    // Still inside the holdback, so approved is empty.
    await expect(
      buildBatch.call(
        {
          periodStart: new Date(Date.now() - 86_400_000),
          periodEnd: new Date(Date.now() + 86_400_000),
          currency: "CAD",
        },
        OWNER,
      ),
    ).rejects.toThrow(/nothing payable/i);
  });

  it("only marks a batch paid once it has been approved", async () => {
    await referredSale({ totalMinor: 10_000, programOverrides: { holdbackDays: 0 } });
    await mature();
    const built = await buildBatch.call(
      {
        periodStart: new Date(Date.now() - 86_400_000),
        periodEnd: new Date(Date.now() + 86_400_000),
        currency: "CAD",
      },
      OWNER,
    );
    await expect(markBatchPaid.call({ batchId: built.batchId }, OWNER)).rejects.toThrow(
      /approved batch/i,
    );
  });

  it("exports a batch as CSV in minor units", async () => {
    await referredSale({ totalMinor: 10_000, programOverrides: { holdbackDays: 0 } });
    await mature();
    const built = await buildBatch.call(
      {
        periodStart: new Date(Date.now() - 86_400_000),
        periodEnd: new Date(Date.now() + 86_400_000),
        currency: "CAD",
      },
      OWNER,
    );
    const csv = await batchCsv.call({ batchId: built.batchId }, OWNER);
    expect(csv.lines).toBe(1);
    expect(csv.csv.split("\r\n")[0]).toContain("amount_minor");
    // 1000, not "10.00": a locale cannot misread an integer on the way to a bank.
    expect(csv.csv).toContain('"1000"');
    expect(csv.filename).toMatch(/^payouts-\d{4}-\d{2}-\d{2}\.csv$/);
  });

  it("defuses a value a spreadsheet would run as a formula", async () => {
    // A payout CSV is opened in Excel by the owner or their accountant. A
    // field starting `=` is executed there, so it must not survive as one.
    await referredSale({ totalMinor: 10_000, programOverrides: { holdbackDays: 0 } });
    await mature();
    const built = await buildBatch.call(
      {
        periodStart: new Date(Date.now() - 86_400_000),
        periodEnd: new Date(Date.now() + 86_400_000),
        currency: "CAD",
      },
      OWNER,
    );
    await db()
      .update(payoutLines)
      .set({ taxFormState: "collected" })
      .where(eq(payoutLines.batchId, built.batchId));
    const csv = await batchCsv.call({ batchId: built.batchId }, OWNER);
    for (const field of csv.csv.split(/\r\n|,/)) {
      expect(field.startsWith('"=')).toBe(false);
      expect(field.startsWith('"+')).toBe(false);
      expect(field.startsWith('"@')).toBe(false);
    }
  });

  it("emits the conversion against the referrer, so points land on them", async () => {
    // §4.13 names "a referral converted" as an earning moment, and this is the
    // row a loyalty earn rule resolves. It is written against the referrer
    // because the buyer is the wrong person to reward for a referral.
    const { referrer, buyer } = await referredSale({ totalMinor: 10_000 });
    const rows = await db()
      .select()
      .from(timelineEvents)
      .where(
        and(
          eq(timelineEvents.eventType, "referral.converted"),
          eq(timelineEvents.contactId, referrer.id),
        ),
      );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.contactId).not.toBe(buyer.id);
  });

  it("still emits the conversion when the programme pays only in points", async () => {
    // A points-only programme writes no cash row, and the event still fires —
    // otherwise "dual-sided rewards can pay in points" would be unreachable.
    const { referrer } = await referredSale({
      totalMinor: 10_000,
      programOverrides: { commission: { kind: "none" } },
    });
    expect(await db().select().from(commissionEvents)).toHaveLength(0);
    const rows = await db()
      .select()
      .from(timelineEvents)
      .where(
        and(
          eq(timelineEvents.eventType, "referral.converted"),
          eq(timelineEvents.contactId, referrer.id),
        ),
      );
    expect(rows).toHaveLength(1);
  });

  it("does not pay for a conversion the programme does not name", async () => {
    const program = await programme({ conversionTypes: ["booking"] });
    const referrer = await contact("referrer@example.com", "Ines");
    const buyer = await contact("buyer@example.com", "Otto");
    await issueCode.call({ programId: program.id, contactId: referrer.id, code: "INES" }, OWNER);
    await recordTouch.call({ code: "INES", contactId: buyer.id, kind: "click" }, OWNER);
    await invoicePaid({ contactId: buyer.id, totalMinor: 10_000, sourceType: "order" });
    expect(await db().select().from(commissionEvents)).toHaveLength(0);
  });

  it("records tax paperwork and prompts for what is missing", async () => {
    const { referrer } = await referredSale({
      totalMinor: 10_000,
      programOverrides: { holdbackDays: 0 },
    });
    await mature();
    const built = await buildBatch.call(
      {
        periodStart: new Date(Date.now() - 86_400_000),
        periodEnd: new Date(Date.now() + 86_400_000),
        currency: "CAD",
      },
      OWNER,
    );
    await approveBatch.call({ batchId: built.batchId }, OWNER);
    await markBatchPaid.call({ batchId: built.batchId }, OWNER);

    await saveTaxProfile.call(
      {
        contactId: referrer.id,
        jurisdiction: "CA",
        formKind: "T4A",
        state: "requested",
        thresholdMinor: 500,
        currency: "CAD",
      },
      OWNER,
    );

    const prompts = await taxPrompts.call(
      { since: new Date(Date.now() - 86_400_000) },
      OWNER,
    );
    expect(prompts).toHaveLength(1);
    expect(prompts[0]!.contactId).toBe(referrer.id);
    expect(prompts[0]!.state).toBe("requested");

    // Once collected, the platform stops asking. It records; it does not file.
    await saveTaxProfile.call(
      {
        contactId: referrer.id,
        jurisdiction: "CA",
        formKind: "T4A",
        state: "collected",
        thresholdMinor: 500,
        currency: "CAD",
      },
      OWNER,
    );
    expect(
      await taxPrompts.call({ since: new Date(Date.now() - 86_400_000) }, OWNER),
    ).toHaveLength(0);
  });

  it("copies the tax state onto the line, so a paid batch keeps what was known", async () => {
    const { referrer } = await referredSale({
      totalMinor: 10_000,
      programOverrides: { holdbackDays: 0 },
    });
    await saveTaxProfile.call(
      { contactId: referrer.id, state: "requested", thresholdMinor: 0 },
      OWNER,
    );
    await mature();
    const built = await buildBatch.call(
      {
        periodStart: new Date(Date.now() - 86_400_000),
        periodEnd: new Date(Date.now() + 86_400_000),
        currency: "CAD",
      },
      OWNER,
    );

    // The paperwork arrives after the batch was built.
    await saveTaxProfile.call(
      { contactId: referrer.id, state: "collected", thresholdMinor: 0 },
      OWNER,
    );

    const [line] = await db()
      .select()
      .from(payoutLines)
      .where(eq(payoutLines.batchId, built.batchId));
    // The batch is a historical document: it still says what was known then.
    expect(line!.taxFormState).toBe("requested");
  });

  it("lets a referrer read their own earnings and nobody else's", async () => {
    const { referrer } = await referredSale({ totalMinor: 10_000 });
    const other = await contact("other@example.com", "Kit");
    expect(await commissions.call({ affiliateContactId: referrer.id }, OWNER)).toHaveLength(1);
    expect(await commissions.call({ affiliateContactId: other.id }, OWNER)).toHaveLength(0);
  });

  it("keeps attribution and payment agreeing about who earned it", async () => {
    // The report and the payout read the same service, so they cannot drift.
    const { program, referrer, buyer } = await referredSale({ totalMinor: 10_000 });
    const attribution = await attributionFor.call(
      { contactId: buyer.id, programId: program.id },
      OWNER,
    );
    const [event] = await db().select().from(commissionEvents);
    expect(attribution.credits[0]!.referrerContactId).toBe(referrer.id);
    expect(event!.affiliateContactId).toBe(attribution.credits[0]!.referrerContactId);
    expect(event!.sharePpm).toBe(PPM);
  });

  it("carries commission across a contact merge, and stays undoable", async () => {
    // The spine rule: a module that adds a contact_id column repoints it in
    // `contacts.merge`. Both of this table's contact columns move, and the
    // merge has to remain reversible — a new table that quietly made every
    // merge permanent would be a worse bug than the one it fixed.
    const { mergeContacts, undoContactMerge } = await import("@/core/contacts/service");
    const { referrer } = await referredSale({ totalMinor: 10_000 });
    const dupe = await contact("ines.second@example.com", "Ines");

    const merged = await mergeContacts.call(
      { duplicateId: dupe.id, survivingId: referrer.id },
      OWNER,
    );
    expect(
      await commissions.call({ affiliateContactId: referrer.id }, OWNER),
    ).toHaveLength(1);

    await undoContactMerge.call({ operationId: merged.mergeOperationId }, OWNER);
    expect(
      await commissions.call({ affiliateContactId: referrer.id }, OWNER),
    ).toHaveLength(1);
  });

  it("totals a batch from its lines", async () => {
    await referredSale({ totalMinor: 10_000, programOverrides: { holdbackDays: 0 } });
    await mature();
    const built = await buildBatch.call(
      {
        periodStart: new Date(Date.now() - 86_400_000),
        periodEnd: new Date(Date.now() + 86_400_000),
        currency: "CAD",
      },
      OWNER,
    );
    const [batch] = await db()
      .select()
      .from(payoutBatches)
      .where(eq(payoutBatches.id, built.batchId));
    expect(batch!.totalMinor).toBe(1_000);
    expect(batch!.status).toBe("draft");
  });
});
