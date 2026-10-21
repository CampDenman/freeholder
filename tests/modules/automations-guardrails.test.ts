// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// May this step proceed? (MASTER.md §4.17, §4.14, §40, C9.03)
//
// The test worth reading first is the untrusted one. §4.17's rule is that
// content from outside is data and never instruction, and §40 draws the line
// by pinning autonomy at `suggest`. That means a run triggered by a form
// submission cannot act on its own however the owner configured it — and the
// taint is a property of the run, so it survives every intervening step.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { runApprovals, runs } from "@/core/runs/schema";
import {
  publish,
  runNow,
  saveAutomation,
} from "@/modules/automations/service";
import { resolveContact } from "@/core/contacts/service";
import { updateBusiness } from "@/core/settings/service";
import { ready } from "@/core/runtime";
import { checkGuardrails } from "@/modules/automations/service";
import { closeDb, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

/**
 * Ask the guardrails through the real service.
 *
 * An earlier draft defined a throwaway service to get a `ServiceContext`, and
 * that deadlocked: `defineService` at module scope pulls `@/core/service` into
 * the import graph, `.call` triggers boot, and boot was then waiting on an
 * import that had not finished. The registry is not a place to improvise.
 *
 * Going through `automations.checkGuardrails` is better anyway — the test now
 * exercises the same path an owner's screen would.
 */
async function ask(input: {
  verb: string;
  contactId?: string | null;
  autonomyCeiling?: "suggest" | "approve" | "autonomous" | null;
  inputTrust?: "owner" | "system" | "untrusted";
  intent?: "transactional" | "marketing";
  costMinor?: number;
  budgetRemainingMinor?: number | null;
}) {
  return checkGuardrails.call(
    {
      verb: input.verb,
      contactId: input.contactId ?? null,
      autonomyCeiling: input.autonomyCeiling ?? null,
      inputTrust: input.inputTrust ?? "system",
      intent: input.intent ?? "transactional",
      costMinor: input.costMinor ?? 0,
      budgetRemainingMinor: input.budgetRemainingMinor ?? null,
    },
    OWNER,
  );
}

const BUSINESS = {
  name: "Aurora Coast Studio",
  country: "CA",
  baseCurrency: "CAD",
  timezone: "America/Vancouver",
};

async function contact(email = "buyer@example.com") {
  const { contact: found } = await resolveContact.call({ email, name: "Nils" }, OWNER);
  return found;
}

const noteGraph = (body: string) => ({
  entry: "note",
  maxSteps: 10,
  nodes: [{ kind: "call", id: "note", verb: "contacts.note", params: { body }, next: null }],
});

describe.runIf(hasDatabase)("deciding whether a step may proceed", () => {
  // Boot once, before the first test rather than inside its hook. Wiring every
  // module is a one-off cost of several seconds, and charging it to the first
  // `beforeEach` is how a suite fails on a timeout that has nothing to do with
  // what it is testing.
  beforeAll(async () => {
    await ready();
  }, 60_000);

  beforeEach(async () => {
    await truncateSpine();
    await updateBusiness.call(BUSINESS, OWNER);
  });

  afterAll(async () => {
    await closeDb();
  });

  it("lets a plain record step through", async () => {
    const person = await contact();
    const verdict = await ask({
      verb: "contacts.note",
      contactId: person.id,
      autonomyCeiling: "autonomous",
      inputTrust: "system",
    });
    expect(verdict.decision).toBe("proceed");
  });

  /* ------------------------------------------------------ untrusted input */

  it("pins an untrusted run to proposing, whatever the owner configured", async () => {
    // §40: "A task whose input is a customer's message can never act by
    // itself, whatever anyone configured." The owner said `autonomous` and it
    // still cannot act — that is the line prompt injection has to cross.
    const person = await contact();
    const verdict = await ask({
      verb: "contacts.note",
      contactId: person.id,
      autonomyCeiling: "autonomous",
      inputTrust: "untrusted",
    });
    expect(verdict.decision).toBe("approve");
    expect(verdict.reason).toMatch(/from outside/i);
  });

  it("says why, so the owner is not left guessing", async () => {
    // The two reasons an approval can be asked for read differently, because
    // an owner deciding needs to know which it was.
    const person = await contact();
    const untrusted = await ask({
      verb: "contacts.note",
      contactId: person.id,
      autonomyCeiling: "autonomous",
      inputTrust: "untrusted",
    });
    const suggesting = await ask({
      verb: "contacts.note",
      contactId: person.id,
      autonomyCeiling: "suggest",
      inputTrust: "system",
    });
    expect(untrusted.reason).toMatch(/from outside/i);
    expect(suggesting.reason).toMatch(/only suggests/i);
    expect(untrusted.reason).not.toBe(suggesting.reason);
  });

  /* ------------------------------------------------------------- ladder */

  it("asks before anything irreversible at the approve rung", async () => {
    // `contacts.setStage` is a record verb, so this asserts the shape through
    // the one money/destructive path an automation can currently reach: none
    // is registered yet, and the ladder is exercised by `suggest` below.
    // C9.06's send verb and C9.10's payout verb are the first real ones, and
    // they arrive with their own tests rather than with a fake here.
    const person = await contact();
    const verdict = await ask({
      verb: "contacts.note",
      contactId: person.id,
      autonomyCeiling: "approve",
      inputTrust: "untrusted",
    });
    // Untrusted lowers to suggest, which asks about everything.
    expect(verdict.decision).toBe("approve");
  });

  it("does not ask before a mere record at the approve rung", async () => {
    // The rung is about consequence, not about caution for its own sake. An
    // owner asked to approve every note stops reading approvals.
    const person = await contact();
    const verdict = await ask({
      verb: "contacts.note",
      contactId: person.id,
      autonomyCeiling: "approve",
      inputTrust: "system",
    });
    expect(verdict.decision).toBe("proceed");
  });

  it("asks about everything when the ceiling is suggest", async () => {
    const person = await contact();
    const verdict = await ask({
      verb: "contacts.note",
      contactId: person.id,
      autonomyCeiling: "suggest",
      inputTrust: "system",
    });
    expect(verdict.decision).toBe("approve");
    expect(verdict.reason).toMatch(/only suggests/i);
  });

  /* ------------------------------------------------------------- budget */

  it("refuses rather than asks when the budget is spent", async () => {
    // An approval whose only honest answer is "there is no money" wastes the
    // owner's attention, which is the scarcer resource.
    const person = await contact();
    const verdict = await ask({
      verb: "contacts.note",
      contactId: person.id,
      autonomyCeiling: "autonomous",
      inputTrust: "system",
      costMinor: 500,
      budgetRemainingMinor: 100,
    });
    expect(verdict.decision).toBe("refuse");
    expect(verdict.reason).toMatch(/budget/i);
  });

  it("lets a step through when it fits inside the budget", async () => {
    const person = await contact();
    const verdict = await ask({
      verb: "contacts.note",
      contactId: person.id,
      autonomyCeiling: "autonomous",
      inputTrust: "system",
      costMinor: 100,
      budgetRemainingMinor: 500,
    });
    expect(verdict.decision).toBe("proceed");
  });

  it("ignores the budget for a step that costs nothing", async () => {
    // A deterministic verb spends nothing, and a zero-cost step blocked by a
    // spent budget would stop an automation doing the free half of its work.
    const person = await contact();
    const verdict = await ask({
      verb: "contacts.note",
      contactId: person.id,
      autonomyCeiling: "autonomous",
      inputTrust: "system",
      costMinor: 0,
      budgetRemainingMinor: 0,
    });
    expect(verdict.decision).toBe("proceed");
  });

  /* ------------------------------------------------------------ consent */

  it("does not ask for marketing consent before a transactional message", async () => {
    // §4.14 requires consent for what is asked of somebody, not for what is
    // owed to them. A booking confirmation is owed.
    const person = await contact();
    const verdict = await ask({
      verb: "contacts.note",
      contactId: person.id,
      autonomyCeiling: "autonomous",
      inputTrust: "system",
      intent: "transactional",
    });
    expect(verdict.decision).toBe("proceed");
  });

  it("does not check consent for a verb that reaches nobody", async () => {
    // §4.14 governs *reaching* somebody. A note is the business writing in its
    // own file, so consent never enters into it — and asserting that keeps the
    // check from creeping onto every verb the moment somebody adds one.
    const person = await contact();
    const verdict = await ask({
      verb: "contacts.note",
      contactId: person.id,
      autonomyCeiling: "autonomous",
      inputTrust: "system",
      intent: "marketing",
    });
    expect(verdict.decision).toBe("proceed");
  });

  /* --------------------------------------------------- through a real run */

  it("parks a run for approval instead of acting", async () => {
    const person = await contact();
    const saved = await saveAutomation.call(
      {
        name: "Needs a nod",
        triggerKind: "event",
        eventPattern: "contact.created",
        autonomyCeiling: "suggest",
        draftGraph: noteGraph("Only with permission"),
      },
      OWNER,
    );
    await publish.call({ automationId: saved.id, activate: true }, OWNER);

    const result = await runNow.call({ automationId: saved.id, contactId: person.id }, OWNER);
    expect(result.state).toBe("waiting");

    // The approval carries what would run, and the run is parked on the node
    // rather than moved past it — approving has to resume in the right place.
    const [approval] = await db().select().from(runApprovals);
    expect(approval!.serviceName).toBe("notes.write");
    expect(approval!.status).toBe("pending");

    const [row] = await db().select().from(runs).where(eq(runs.id, result.runId!));
    expect(row!.resumeNodeId).toBe("note");
    expect(row!.status).toBe("running");

    // And nothing was written.
    const { listNotes } = await import("@/core/notes/service");
    expect(
      await listNotes.call({ subjectType: "contact", subjectId: person.id }, OWNER),
    ).toHaveLength(0);
  });

  it("runs straight through when the automation is autonomous", async () => {
    const person = await contact();
    const saved = await saveAutomation.call(
      {
        name: "Just do it",
        triggerKind: "event",
        eventPattern: "contact.created",
        autonomyCeiling: "autonomous",
        draftGraph: noteGraph("Done without asking"),
      },
      OWNER,
    );
    await publish.call({ automationId: saved.id, activate: true }, OWNER);

    const result = await runNow.call({ automationId: saved.id, contactId: person.id }, OWNER);
    expect(result.state).toBe("done");
    expect(await db().select().from(runApprovals)).toHaveLength(0);
  });
});
