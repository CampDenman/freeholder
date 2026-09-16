// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// One answer to "who" (MASTER.md §30, §43 C7.17).
//
// C7.04 built the segment model; C7.17 is the adoption. The test that matters
// is the last one: the *same* segment decides a campaign's audience, an
// automation's entry and a report's cohort, and all three agree with
// `segments.members` about who is in it. Two surfaces each compiling their own
// version of "customers in Ontario who bought twice" is how a business ends up
// with two numbers, and how somebody deliberately excluded from an audience
// receives the campaign anyway.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/core/db";
import { users } from "@/core/auth/schema";
import { invoices } from "@/modules/invoicing/schema";
import { resolveContact } from "@/core/contacts/service";
import { saveSegment, segmentMembership } from "@/core/segments/service";
import { automationVersions } from "@/modules/automations/schema";
import { publish, runNow, saveAutomation } from "@/modules/automations/service";
import { cohortReport } from "@/modules/reporting/service";
import {
  broadcastRecipientList,
  saveBroadcast,
  saveTemplate,
  startBroadcast,
} from "@/modules/newsletters/service";
import { updateBusiness } from "@/core/settings/service";
import { eq } from "drizzle-orm";
import { ready } from "@/core/runtime";
import { closeDb, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

const ago = (days: number) => new Date(Date.now() - days * 86_400_000);

let sequence = 0;

async function person(name: string, country: string) {
  const { contact } = await resolveContact.call(
    { email: `${name}@example.test`, name, country },
    OWNER,
  );
  return contact;
}

async function paid(contactId: string, totalMinor: number) {
  sequence += 1;
  await db().insert(invoices).values({
    contactId,
    number: `INV-${sequence}`,
    sequenceKey: "default",
    idempotencyKey: `one-audience-${sequence}`,
    requestHash: String(sequence).padStart(64, "0"),
    currency: "CAD",
    status: "paid",
    subtotalMinor: totalMinor,
    totalMinor,
    paidMinor: totalMinor,
    issuedAt: ago(3),
    paidAt: ago(3),
  });
}

/** Somebody in Canada — a rule the segment model already knows how to answer. */
async function canadians(name: string) {
  return saveSegment.call(
    {
      name,
      definition: {
        match: "all",
        rules: [{ field: "contact.country", op: "is", value: "CA" }],
      },
    },
    OWNER,
  );
}

describe.runIf(hasDatabase)("one answer to who", () => {
  beforeAll(async () => {
    await ready();
  }, 60_000);

  beforeEach(async () => {
    await truncateSpine();
    await db()
      .insert(users)
      .values({ id: OWNER.userId, email: "owner@example.test", role: "owner" })
      .onConflictDoNothing();
    await updateBusiness.call(
      {
        name: "Aurora Coast Studio",
        country: "CA",
        baseCurrency: "CAD",
        timezone: "America/Vancouver",
      },
      OWNER,
    );
  });

  afterAll(async () => {
    await closeDb();
  });

  /* ------------------------------------------------- automations (§4.17) */

  async function automationFor(segmentId: string | null) {
    const saved = await saveAutomation.call(
      {
        name: `Rule ${Math.random().toString(36).slice(2, 8)}`,
        // Manual with an audience is exactly the case C7.17 makes possible:
        // "run this for everyone in the segment" needs no event to carry the
        // contact, because the audience already says there is one. Without an
        // audience there is nobody, so those cases use an event trigger.
        triggerKind: segmentId ? "manual" : "event",
        eventPattern: segmentId ? null : "contact.created",
        entrySegmentId: segmentId,
        draftGraph: {
          entry: "note",
          maxSteps: 20,
          nodes: [
            { kind: "call", id: "note", verb: "contacts.note", params: { body: "Hello" }, next: null },
          ],
        },
      },
      OWNER,
    );
    await publish.call({ automationId: saved.id, activate: true }, OWNER);
    return saved;
  }

  it("lets in somebody the segment includes", async () => {
    const local = await person("local", "CA");
    const segment = await canadians("Canadians in");
    const automation = await automationFor(segment.id);

    const result = await runNow.call({ automationId: automation.id, contactId: local.id }, OWNER);
    expect(result.started).toBe(true);
  });

  it("keeps out somebody the segment excludes", async () => {
    // The failure this exists to prevent. `entry_segment_id` was stored from
    // C9.01 and never read, so an automation with an audience ran for
    // everybody — including the people it was written to leave out.
    const abroad = await person("abroad", "FR");
    const segment = await canadians("Canadians out");
    const automation = await automationFor(segment.id);

    const result = await runNow.call({ automationId: automation.id, contactId: abroad.id }, OWNER);
    expect(result.started).toBe(false);
    expect(result.reason).toMatch(/audience/i);
  });

  it("refuses to run an audience automation for nobody", async () => {
    const segment = await canadians("Canadians nobody");
    const automation = await automationFor(segment.id);

    const result = await runNow.call({ automationId: automation.id }, OWNER);
    expect(result.started).toBe(false);
  });

  it("runs for anybody when no audience was set", async () => {
    const anyone = await person("anyone", "FR");
    const automation = await automationFor(null);

    const result = await runNow.call({ automationId: automation.id, contactId: anyone.id }, OWNER);
    expect(result.started).toBe(true);
  });

  it("pins the audience to the published version", async () => {
    // Narrowing an audience is an edit, and last month's runs were not
    // narrowed. The version carries it for the same reason it carries the
    // trigger.
    const segment = await canadians("Canadians pinned");
    const automation = await automationFor(segment.id);

    const [version] = await db()
      .select()
      .from(automationVersions)
      .where(eq(automationVersions.automationId, automation.id));
    expect(version!.entrySegmentId).toBe(segment.id);
  });

  /* ---------------------------------------------------- reports (§2535) */

  it("cuts a cohort report to a segment", async () => {
    const local = await person("cohortlocal", "CA");
    const abroad = await person("cohortabroad", "FR");
    await paid(local.id, 5_000);
    await paid(abroad.id, 9_000);

    const everyone = await cohortReport.call({ months: 12 }, OWNER);
    const totalOf = (report: Awaited<ReturnType<typeof cohortReport.call>>) =>
      report.cohorts.flatMap((each) => each.cells).reduce((sum, cell) => sum + cell.amountMinor, 0);
    expect(totalOf(everyone)).toBe(14_000);

    const segment = await canadians("Canadians cohort");
    const canadian = await cohortReport.call({ months: 12, segmentId: segment.id }, OWNER);
    expect(totalOf(canadian)).toBe(5_000);
  });

  /* -------------------------------------------------- the convergence */

  it("gives the same answer to every surface that asks", async () => {
    // The point of C7.17. One definition, three consumers, one answer — and
    // the check is behavioural rather than architectural, because a rule that
    // says "call this service" can be obeyed by code that then ignores what it
    // returns.
    const inside = await person("inside", "CA");
    const outside = await person("outside", "FR");
    await paid(inside.id, 3_000);
    await paid(outside.id, 4_000);

    const segment = await canadians("Canadians everywhere");

    // 1. The segment itself.
    const members = await segmentMembership.call({ id: segment.id, limit: 100 }, OWNER);
    expect(members.map((each) => each.id)).toEqual([inside.id]);

    // 2. An automation's entry condition.
    const automation = await automationFor(segment.id);
    expect(
      (await runNow.call({ automationId: automation.id, contactId: inside.id }, OWNER)).started,
    ).toBe(true);
    expect(
      (await runNow.call({ automationId: automation.id, contactId: outside.id }, OWNER)).started,
    ).toBe(false);

    // 3. A report's cohort.
    const report = await cohortReport.call({ months: 12, segmentId: segment.id }, OWNER);
    const total = report.cohorts
      .flatMap((each) => each.cells)
      .reduce((sum, cell) => sum + cell.amountMinor, 0);
    expect(total).toBe(3_000);

    // 4. A campaign's audience. Frozen from the same segment (C9.06), so the
    // people a report counts are the people a campaign reaches.
    const template = await saveTemplate.call(
      {
        kind: "campaign",
        name: "Hello",
        subject: "Hello",
        blocks: [{ type: "text", props: { body: "Hello." } }],
        status: "active",
      },
      OWNER,
    );
    const broadcast = await saveBroadcast.call(
      { name: "To the audience", templateId: template.id, segmentId: segment.id },
      OWNER,
    );
    await startBroadcast.call({ id: broadcast.id }, OWNER);
    const recipients = await broadcastRecipientList.call({ id: broadcast.id }, OWNER);
    expect(recipients.map((each) => each.contactId)).toEqual([inside.id]);
  });
});
