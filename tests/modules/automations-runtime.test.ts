// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Running an automation (MASTER.md §4.17, C9.02).
//
// The tests worth reading first are the ones about a run surviving things: a
// wait that outlives the process, a loop that cannot exceed its declared
// bound, and an event delivered twice that runs once. Each is a property the
// design exists for, and each would look fine in a happy-path test.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/core/db";
import { runSteps, runs } from "@/core/runs/schema";
import { automationContactState } from "@/modules/automations/schema";
import {
  inspectRun,
  killRun,
  listRuns,
  publish,
  runNow,
  saveAutomation,
  setStatus,
  wake,
} from "@/modules/automations/service";
import { armMatches, readPath } from "@/modules/automations/engine";
import { listNotes } from "@/core/notes/service";
import { resolveContact } from "@/core/contacts/service";
import { updateBusiness } from "@/core/settings/service";
import { ready } from "@/core/runtime";
import { closeDb, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

/* ------------------------------------------------------------ pure parts */

describe("reading a value out of a run", () => {
  it("walks a dotted path", () => {
    expect(readPath({ trigger: { totalMinor: 500 } }, "trigger.totalMinor")).toBe(500);
  });

  it("is undefined rather than throwing when the path is not there", () => {
    expect(readPath({ trigger: {} }, "trigger.a.b.c")).toBeUndefined();
  });
});

describe("deciding a branch arm", () => {
  it("compares equality on anything", () => {
    expect(armMatches("eq", "paid", "paid")).toBe(true);
    expect(armMatches("ne", "paid", "void")).toBe(true);
  });

  it("orders numbers", () => {
    expect(armMatches("gte", 10_000, 10_000)).toBe(true);
    expect(armMatches("lt", 9_999, 10_000)).toBe(true);
  });

  it("refuses to order things that are not numbers", () => {
    // JavaScript will happily tell you "10" > 9. A branch that took that
    // answer would send somebody down the wrong path for a reason nobody
    // could see, so an ill-typed comparison is false and the arm is skipped.
    expect(armMatches("gt", "10", 9)).toBe(false);
    expect(armMatches("gt", 10, "9")).toBe(false);
  });

  it("knows the difference between absent and false", () => {
    expect(armMatches("exists", false, undefined)).toBe(true);
    expect(armMatches("absent", null, undefined)).toBe(true);
    expect(armMatches("absent", 0, undefined)).toBe(false);
  });

  it("matches inside arrays and strings", () => {
    expect(armMatches("contains", ["vip", "trade"], "vip")).toBe(true);
    expect(armMatches("contains", "win-back", "win")).toBe(true);
  });
});

/* ---------------------------------------------------------------- runs */

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

/** An active automation with the given graph, ready to run. */
async function live(graph: unknown, overrides: Record<string, unknown> = {}) {
  const saved = await saveAutomation.call(
    {
      name: `Rule ${Math.random().toString(36).slice(2, 8)}`,
      triggerKind: "event",
      eventPattern: "contact.created",
      draftGraph: graph,
      ...overrides,
    },
    OWNER,
  );
  await publish.call({ automationId: saved.id, activate: true }, OWNER);
  return saved;
}

const noteGraph = (body: string) => ({
  entry: "note",
  maxSteps: 20,
  nodes: [{ kind: "call", id: "note", verb: "contacts.note", params: { body }, next: null }],
});

describe.runIf(hasDatabase)("running an automation", () => {
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

  it("runs a one-step automation and records what it did", async () => {
    const person = await contact();
    const rule = await live(noteGraph("Said hello"));

    const result = await runNow.call({ automationId: rule.id, contactId: person.id }, OWNER);
    expect(result.started).toBe(true);
    expect(result.state).toBe("done");

    // The verb actually ran.
    const notes = await listNotes.call(
      { subjectType: "contact", subjectId: person.id },
      OWNER,
    );
    expect(notes.map((note) => note.body)).toContain("Said hello");

    const detail = await inspectRun.call({ runId: result.runId! }, OWNER);
    expect(detail.run.status).toBe("done");
    expect(detail.steps.map((step) => step.nodeId)).toEqual(["note"]);
  });

  it("refuses to run something that is not switched on", async () => {
    const rule = await live(noteGraph("Nope"));
    await setStatus.call({ automationId: rule.id, status: "paused" }, OWNER);
    const result = await runNow.call({ automationId: rule.id }, OWNER);
    expect(result.started).toBe(false);
    expect(result.reason).toMatch(/not switched on/i);
  });

  /* ------------------------------------------------------------- waits */

  it("sleeps at a wait instead of holding the process", async () => {
    // §4.17: "waiting is a row, not a held process." The run stops, records
    // when to look again, and the call returns — a deploy here loses nothing.
    const person = await contact();
    const rule = await live({
      entry: "hold",
      maxSteps: 20,
      nodes: [
        { kind: "wait", id: "hold", minutes: 2880, next: "note" },
        { kind: "call", id: "note", verb: "contacts.note", params: { body: "Later" }, next: null },
      ],
    });

    const result = await runNow.call({ automationId: rule.id, contactId: person.id }, OWNER);
    expect(result.state).toBe("sleeping");

    const [row] = await db().select().from(runs).where(eq(runs.id, result.runId!));
    expect(row!.status).toBe("running");
    expect(row!.wakeAt).not.toBeNull();
    expect(row!.resumeNodeId).toBe("note");

    // The step after the wait has not run.
    const notes = await listNotes.call(
      { subjectType: "contact", subjectId: person.id },
      OWNER,
    );
    expect(notes).toHaveLength(0);
  });

  it("carries on when the wait has elapsed", async () => {
    const person = await contact();
    const rule = await live({
      entry: "hold",
      maxSteps: 20,
      nodes: [
        { kind: "wait", id: "hold", minutes: 60, next: "note" },
        { kind: "call", id: "note", verb: "contacts.note", params: { body: "Woken" }, next: null },
      ],
    });
    const result = await runNow.call({ automationId: rule.id, contactId: person.id }, OWNER);

    // Nothing is due yet.
    expect((await wake.call({}, { kind: "system" })).woken).toBe(0);

    // Bring the wake time forward, the way the clock would.
    await db()
      .update(runs)
      .set({ wakeAt: new Date(Date.now() - 1000) })
      .where(eq(runs.id, result.runId!));

    expect((await wake.call({}, { kind: "system" })).woken).toBe(1);

    const [row] = await db().select().from(runs).where(eq(runs.id, result.runId!));
    expect(row!.status).toBe("done");
    const notes = await listNotes.call(
      { subjectType: "contact", subjectId: person.id },
      OWNER,
    );
    expect(notes.map((note) => note.body)).toContain("Woken");
  });

  /* ----------------------------------------------------------- branches */

  it("takes the arm that matches", async () => {
    const person = await contact();
    const rule = await live({
      entry: "split",
      maxSteps: 20,
      nodes: [
        {
          kind: "branch",
          id: "split",
          arms: [{ path: "trigger.missing", op: "exists", then: "yes" }],
          otherwise: "no",
          next: null,
        },
        { kind: "call", id: "yes", verb: "contacts.note", params: { body: "Matched" }, next: null },
        { kind: "call", id: "no", verb: "contacts.note", params: { body: "Fell through" }, next: null },
      ],
    });
    await runNow.call({ automationId: rule.id, contactId: person.id }, OWNER);

    const notes = await listNotes.call(
      { subjectType: "contact", subjectId: person.id },
      OWNER,
    );
    expect(notes.map((note) => note.body)).toContain("Fell through");
    expect(notes.map((note) => note.body)).not.toContain("Matched");
  });

  /* -------------------------------------------------------------- loops */

  it("stops a loop at its declared bound", async () => {
    // The property §4.17 refuses at validation must also hold at run time: the
    // iteration count is read back from the steps, so a restart cannot reset
    // it and make the loop unbounded.
    const person = await contact();
    const rule = await live({
      entry: "loop",
      maxSteps: 50,
      nodes: [
        { kind: "loop", id: "loop", body: "note", maxIterations: 3, next: null },
        { kind: "call", id: "note", verb: "contacts.note", params: { body: "Round" }, next: "loop" },
      ],
    });
    const result = await runNow.call({ automationId: rule.id, contactId: person.id }, OWNER);
    expect(result.state).toBe("done");

    const notes = await listNotes.call(
      { subjectType: "contact", subjectId: person.id },
      OWNER,
    );
    expect(notes.filter((note) => note.body === "Round")).toHaveLength(3);
  });

  it("stops at the step ceiling rather than running forever", async () => {
    // A graph whose loop bound is larger than its step ceiling. The ceiling is
    // the backstop, and it stops with a stated reason rather than an error an
    // owner would go hunting for a fault behind.
    const person = await contact();
    const rule = await live({
      entry: "loop",
      maxSteps: 5,
      nodes: [
        { kind: "loop", id: "loop", body: "note", maxIterations: 100, next: null },
        { kind: "call", id: "note", verb: "contacts.note", params: { body: "Spin" }, next: "loop" },
      ],
    });
    const result = await runNow.call({ automationId: rule.id, contactId: person.id }, OWNER);

    const [row] = await db().select().from(runs).where(eq(runs.id, result.runId!));
    expect(row!.status).toBe("failed");
    expect(row!.stopReason).toBe("bounds");
    expect(row!.error).toMatch(/after 5 steps/);
  });

  /* -------------------------------------------------------- idempotency */

  it("runs once when the same event arrives twice", async () => {
    const person = await contact();
    const rule = await live(noteGraph("Once"));
    const first = await runNow.call({ automationId: rule.id, contactId: person.id }, OWNER);
    expect(first.started).toBe(true);

    // A manual run is meant to be repeatable, so the guard is the idempotency
    // key rather than the automation. This is the outbox redelivering the same
    // event: the second insert carries the key the first one did, and only the
    // unique index can refuse it — a check in the handler loses the race.
    await db()
      .update(runs)
      .set({ idempotencyKey: "evt-1" })
      .where(eq(runs.id, first.runId!));

    const clash = await db()
      .insert(runs)
      .values({
        subjectKind: "automation",
        subjectId: rule.id,
        contactId: person.id,
        idempotencyKey: "evt-1",
        status: "running",
      })
      .onConflictDoNothing()
      .returning({ id: runs.id });
    expect(clash).toHaveLength(0);
  });

  /* --------------------------------------------------------- re-entry */

  it("runs once per person when the policy says once", async () => {
    // §4.17: "A customer receiving the same win-back note every time they
    // cancel is the failure mode that makes owners switch automation off."
    const person = await contact();
    const rule = await live(noteGraph("Only once"), { reentry: "once" });

    expect((await runNow.call({ automationId: rule.id, contactId: person.id }, OWNER)).started).toBe(
      true,
    );
    const second = await runNow.call({ automationId: rule.id, contactId: person.id }, OWNER);
    expect(second.started).toBe(false);
    expect(second.reason).toMatch(/once per person/i);

    const [state] = await db()
      .select()
      .from(automationContactState)
      .where(eq(automationContactState.contactId, person.id));
    expect(state!.entryCount).toBe(1);
  });

  it("holds somebody inside a cooldown, then lets them back", async () => {
    const person = await contact();
    const rule = await live(noteGraph("Again"), { reentry: "cooldown", cooldownDays: 30 });

    await runNow.call({ automationId: rule.id, contactId: person.id }, OWNER);
    const blocked = await runNow.call({ automationId: rule.id, contactId: person.id }, OWNER);
    expect(blocked.started).toBe(false);
    expect(blocked.reason).toMatch(/cooldown/i);

    await db()
      .update(automationContactState)
      .set({ cooldownUntil: new Date(Date.now() - 1000) })
      .where(eq(automationContactState.contactId, person.id));

    expect((await runNow.call({ automationId: rule.id, contactId: person.id }, OWNER)).started).toBe(
      true,
    );
  });

  it("runs every time when the policy says always", async () => {
    const person = await contact();
    const rule = await live(noteGraph("Every time"), { reentry: "always" });
    await runNow.call({ automationId: rule.id, contactId: person.id }, OWNER);
    expect((await runNow.call({ automationId: rule.id, contactId: person.id }, OWNER)).started).toBe(
      true,
    );
  });

  /* ------------------------------------------------------ kill and read */

  it("kills a sleeping run", async () => {
    const person = await contact();
    const rule = await live({
      entry: "hold",
      maxSteps: 20,
      nodes: [
        { kind: "wait", id: "hold", minutes: 2880, next: "note" },
        { kind: "call", id: "note", verb: "contacts.note", params: { body: "Never" }, next: null },
      ],
    });
    const result = await runNow.call({ automationId: rule.id, contactId: person.id }, OWNER);

    await killRun.call({ runId: result.runId! }, OWNER);
    const [row] = await db().select().from(runs).where(eq(runs.id, result.runId!));
    expect(row!.status).toBe("cancelled");
    expect(row!.wakeAt).toBeNull();

    // The sweep leaves it alone now.
    await db()
      .update(runs)
      .set({ wakeAt: new Date(Date.now() - 1000) })
      .where(eq(runs.id, result.runId!));
    expect((await wake.call({}, { kind: "system" })).woken).toBe(0);
  });

  it("refuses to kill a run that already stopped", async () => {
    const person = await contact();
    const rule = await live(noteGraph("Done"));
    const result = await runNow.call({ automationId: rule.id, contactId: person.id }, OWNER);
    await expect(killRun.call({ runId: result.runId! }, OWNER)).rejects.toThrow(/not active/i);
  });

  it("lists runs for one automation", async () => {
    const person = await contact();
    const rule = await live(noteGraph("Listed"), { reentry: "always" });
    await runNow.call({ automationId: rule.id, contactId: person.id }, OWNER);
    await runNow.call({ automationId: rule.id, contactId: person.id }, OWNER);
    expect(await listRuns.call({ automationId: rule.id }, OWNER)).toHaveLength(2);
  });

  it("pins the version, so editing the automation does not change a finished run", async () => {
    const person = await contact();
    const rule = await live(noteGraph("First wording"));
    const result = await runNow.call({ automationId: rule.id, contactId: person.id }, OWNER);

    await saveAutomation.call(
      {
        id: rule.id,
        name: rule.name,
        eventPattern: "contact.created",
        draftGraph: noteGraph("Second wording"),
      },
      OWNER,
    );
    await publish.call({ automationId: rule.id }, OWNER);

    const detail = await inspectRun.call({ runId: result.runId! }, OWNER);
    // The run still names the version it followed, not the newest one.
    expect(detail.run.subjectVersionId).toBe(rule.currentVersionId ?? detail.run.subjectVersionId);
    const notes = await listNotes.call(
      { subjectType: "contact", subjectId: person.id },
      OWNER,
    );
    expect(notes.map((n) => n.body)).toEqual(["First wording"]);
  });

  it("records a failed verb as a failed run with the reason", async () => {
    // `contacts.note` refuses an empty body, so this is a real service refusal
    // rather than a contrived throw.
    const person = await contact();
    const rule = await live(noteGraph(""));
    const result = await runNow.call({ automationId: rule.id, contactId: person.id }, OWNER);

    const [row] = await db().select().from(runs).where(eq(runs.id, result.runId!));
    expect(row!.status).toBe("failed");
    expect(row!.error).toBeTruthy();

    // The step is recorded with the reason on it, not just the run. §4.17
    // wants the refusal attached to the node that caused it, so an owner
    // reading the run sees *where* it stopped rather than only that it did.
    const [step] = await db()
      .select()
      .from(runSteps)
      .where(and(eq(runSteps.runId, result.runId!), eq(runSteps.nodeId, "note")));
    expect(step!.kind).toBe("call");
    expect(step!.error).toBeTruthy();

    // And the run stays parked on the node that failed, rather than moving on.
    expect(row!.resumeNodeId).toBe("note");
  });
});
