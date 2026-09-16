// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Building, validating and versioning automations (MASTER.md §4.17, C9.01).
//
// The tests worth reading first are the ones that refuse things: a loop with
// no bound, a step that can never be reached, a verb that acts on a contact in
// an automation that has none. §4.17 says a graph that can express an
// unbounded loop is refused *when it is saved*, and a validator is only
// enforcing that while something checks.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { automationVersions, automations } from "@/modules/automations/schema";
import {
  getAutomation,
  listAutomations,
  publish,
  restoreVersion,
  saveAutomation,
  setStatus,
  triggers,
  validate,
  verbs,
  versionGraph,
  versions,
} from "@/modules/automations/service";
import { validateGraph, type AutomationGraph } from "@/modules/automations/graph";
import { updateBusiness } from "@/core/settings/service";
import { closeDb, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

/* ------------------------------------------------------------ validation */

// No database. "Why was my automation refused" has to be answerable without
// an instance, the same way commission arithmetic is.
const known = {
  verbs: new Set(["contacts.note", "tasks.create"]),
  verbsNeedingContact: new Set(["contacts.note"]),
  triggerHasContact: true,
};

function graph(nodes: AutomationGraph["nodes"], entry = "a"): AutomationGraph {
  return { entry, nodes, maxSteps: 100 };
}

describe("what makes a graph invalid", () => {
  it("accepts a straight line", () => {
    const problems = validateGraph(
      graph([
        { kind: "call", id: "a", verb: "contacts.note", params: { body: "hi" }, next: "b" },
        { kind: "stop", id: "b", next: null },
      ]),
      known,
    );
    expect(problems).toEqual([]);
  });

  it("refuses a cycle with nothing bounding it", () => {
    // The rule §4.17 exists to enforce. A -> B -> A runs until something else
    // stops it, and "the run hit its step ceiling" is a report about a mistake
    // nobody was told they had made.
    const problems = validateGraph(
      graph([
        { kind: "call", id: "a", verb: "contacts.note", params: {}, next: "b" },
        { kind: "call", id: "b", verb: "contacts.note", params: {}, next: "a" },
      ]),
      known,
    );
    expect(problems.some((p) => /loop with no limit/i.test(p.message))).toBe(true);
  });

  it("accepts the same cycle once a loop bounds it", () => {
    const problems = validateGraph(
      graph([
        { kind: "loop", id: "a", body: "b", maxIterations: 5, next: null },
        { kind: "call", id: "b", verb: "contacts.note", params: {}, next: "a" },
      ]),
      known,
    );
    expect(problems).toEqual([]);
  });

  it("refuses a step that can never be reached", () => {
    // Not fatal to a run, but always a mistake: somebody drew a step and never
    // connected it, and silently never running it is how an owner concludes
    // the feature is broken.
    const problems = validateGraph(
      graph([
        { kind: "stop", id: "a", next: null },
        { kind: "call", id: "orphan", verb: "contacts.note", params: {}, next: null },
      ]),
      known,
    );
    expect(problems.some((p) => p.nodeId === "orphan" && /never be reached/.test(p.message))).toBe(
      true,
    );
  });

  it("refuses a verb no installed module provides", () => {
    const problems = validateGraph(
      graph([{ kind: "call", id: "a", verb: "shop.refundEverything", params: {}, next: null }]),
      known,
    );
    expect(problems.some((p) => /not something any installed module can do/.test(p.message))).toBe(
      true,
    );
  });

  it("refuses a contact verb when the trigger has no contact", () => {
    // A schedule-triggered automation has no contact, and "note the contact"
    // with no contact would either throw at 3am or silently do nothing.
    const problems = validateGraph(
      graph([{ kind: "call", id: "a", verb: "contacts.note", params: {}, next: null }]),
      { ...known, triggerHasContact: false },
    );
    expect(problems.some((p) => /does not have one/.test(p.message))).toBe(true);
  });

  it("allows a contact-free verb on a schedule", () => {
    const problems = validateGraph(
      graph([{ kind: "call", id: "a", verb: "tasks.create", params: {}, next: null }]),
      { ...known, triggerHasContact: false },
    );
    expect(problems).toEqual([]);
  });

  it("refuses an edge pointing at a step that is not there", () => {
    const problems = validateGraph(
      graph([{ kind: "call", id: "a", verb: "tasks.create", params: {}, next: "ghost" }]),
      known,
    );
    expect(problems.some((p) => /"ghost", which is not a step here/.test(p.message))).toBe(true);
  });

  it("reports every problem at once, not the first", () => {
    // An owner fixing a canvas one error per save is doing the validator's work.
    const problems = validateGraph(
      graph([
        { kind: "call", id: "a", verb: "nope.missing", params: {}, next: "ghost" },
        { kind: "call", id: "orphan", verb: "also.missing", params: {}, next: null },
      ]),
      known,
    );
    expect(problems.length).toBeGreaterThanOrEqual(3);
  });

  it("accepts a branch with two arms and a fallthrough", () => {
    const problems = validateGraph(
      graph([
        {
          kind: "branch",
          id: "a",
          arms: [
            { path: "trigger.totalMinor", op: "gte", value: 10_000, then: "big" },
            { path: "trigger.totalMinor", op: "lt", value: 10_000, then: "small" },
          ],
          otherwise: "small",
          next: null,
        },
        { kind: "call", id: "big", verb: "tasks.create", params: {}, next: null },
        { kind: "call", id: "small", verb: "tasks.create", params: {}, next: null },
      ]),
      known,
    );
    expect(problems).toEqual([]);
  });
});

/* ----------------------------------------------------------------- rest */

const BUSINESS = {
  name: "Aurora Coast Studio",
  country: "CA",
  baseCurrency: "CAD",
  timezone: "America/Vancouver",
};

const SIMPLE = {
  entry: "note",
  maxSteps: 10,
  nodes: [
    { kind: "call", id: "note", verb: "contacts.note", params: { body: "Said hello" }, next: null },
  ],
};

async function automation(overrides: Record<string, unknown> = {}) {
  return saveAutomation.call(
    {
      name: "Welcome",
      triggerKind: "event",
      eventPattern: "contact.created",
      draftGraph: SIMPLE,
      ...overrides,
    },
    OWNER,
  );
}

describe.runIf(hasDatabase)("automations", () => {
  beforeEach(async () => {
    await truncateSpine();
    await updateBusiness.call(BUSINESS, OWNER);
  });

  afterAll(async () => {
    await closeDb();
  });

  it("offers triggers from what modules declare they emit", async () => {
    // Built from the manifests, not a hand-kept list: a constant is wrong the
    // first time a module adds an event, and wrong silently.
    const available = await triggers.call({}, OWNER);
    expect(available.length).toBeGreaterThan(20);
    expect(available.map((each) => each.name)).toContain("contact.created");
    expect(available.map((each) => each.name)).toContain("automation.published");
  });

  it("offers only verbs a module registered", async () => {
    const palette = await verbs.call({}, OWNER);
    expect(palette.map((each) => each.key)).toContain("contacts.note");
    // The allow-list is the point: a perfectly good service nobody registered
    // is not one dropdown away from an owner dragging boxes on a canvas.
    expect(palette.map((each) => each.key)).not.toContain("contacts.merge");
  });

  it("refuses a trigger no installed module emits", async () => {
    await expect(
      automation({ eventPattern: "shop.somethingInvented" }),
    ).rejects.toThrow(/Nothing installed emits/);
  });

  it("saves a draft that does not validate yet", async () => {
    // A canvas mid-edit is not an error. Only publishing insists.
    const saved = await automation({ draftGraph: { entry: "a", nodes: [] } });
    expect(saved.status).toBe("draft");
    const read = await getAutomation.call({ automationId: saved.id }, OWNER);
    expect(read.problems.length).toBeGreaterThan(0);
  });

  it("refuses to publish a graph that does not hold up", async () => {
    const saved = await automation({
      draftGraph: {
        entry: "a",
        maxSteps: 10,
        nodes: [
          { kind: "call", id: "a", verb: "contacts.note", params: {}, next: "b" },
          { kind: "call", id: "b", verb: "contacts.note", params: {}, next: "a" },
        ],
      },
    });
    await expect(publish.call({ automationId: saved.id }, OWNER)).rejects.toThrow(
      /loop with no limit/i,
    );
    expect(await db().select().from(automationVersions)).toHaveLength(0);
  });

  it("publishes a valid draft as version 1", async () => {
    const saved = await automation();
    const published = await publish.call({ automationId: saved.id }, OWNER);
    expect(published.version).toBe(1);

    const [row] = await db().select().from(automations).where(eq(automations.id, saved.id));
    expect(row!.currentVersionId).toBe(published.versionId);
  });

  it("numbers versions from one, contiguously", async () => {
    const saved = await automation();
    await publish.call({ automationId: saved.id }, OWNER);
    await saveAutomation.call(
      { id: saved.id, name: "Welcome", eventPattern: "contact.created", draftGraph: SIMPLE },
      OWNER,
    );
    await publish.call({ automationId: saved.id, note: "Reworded" }, OWNER);

    const history = await versions.call({ automationId: saved.id }, OWNER);
    expect(history.map((each) => each.version)).toEqual([2, 1]);
  });

  it("keeps a published version unchanged when the draft moves on", async () => {
    // §4.17: a run must be readable against the rules it was actually given.
    const saved = await automation();
    const first = await publish.call({ automationId: saved.id }, OWNER);
    await saveAutomation.call(
      {
        id: saved.id,
        name: "Welcome",
        eventPattern: "contact.created",
        draftGraph: {
          entry: "note",
          maxSteps: 10,
          nodes: [
            { kind: "call", id: "note", verb: "contacts.note", params: { body: "Changed" }, next: null },
          ],
        },
      },
      OWNER,
    );

    const stored = await versionGraph.call({ versionId: first.versionId }, OWNER);
    const nodes = (stored.graph as typeof SIMPLE).nodes;
    expect(nodes[0]!.params).toEqual({ body: "Said hello" });
  });

  it("records the trigger as it was when the version was published", async () => {
    // An automation moved to a schedule next week does not make this version's
    // runs scheduled.
    const saved = await automation();
    await publish.call({ automationId: saved.id }, OWNER);
    await saveAutomation.call(
      {
        id: saved.id,
        name: "Welcome",
        triggerKind: "schedule",
        scheduleCron: "0 9 * * *",
        draftGraph: SIMPLE,
      },
      OWNER,
    );
    const history = await versions.call({ automationId: saved.id }, OWNER);
    expect(history[0]!.triggerKind).toBe("event");
    expect(history[0]!.eventPattern).toBe("contact.created");
  });

  it("restores an old version into the draft rather than rewriting history", async () => {
    const saved = await automation();
    const first = await publish.call({ automationId: saved.id }, OWNER);
    await saveAutomation.call(
      {
        id: saved.id,
        name: "Welcome",
        eventPattern: "contact.created",
        draftGraph: {
          entry: "note",
          maxSteps: 10,
          nodes: [
            { kind: "call", id: "note", verb: "contacts.note", params: { body: "Newer" }, next: null },
          ],
        },
      },
      OWNER,
    );
    await publish.call({ automationId: saved.id }, OWNER);

    await restoreVersion.call({ versionId: first.versionId }, OWNER);
    const read = await getAutomation.call({ automationId: saved.id }, OWNER);
    const nodes = (read.draftGraph as typeof SIMPLE).nodes;
    expect(nodes[0]!.params).toEqual({ body: "Said hello" });
    // Restoring filled the draft; it did not delete version 2.
    expect(await versions.call({ automationId: saved.id }, OWNER)).toHaveLength(2);
  });

  it("refuses to switch on something never published", async () => {
    // "Active" and unable to run is a state an owner would read as working.
    const saved = await automation();
    await expect(
      setStatus.call({ automationId: saved.id, status: "active" }, OWNER),
    ).rejects.toThrow(/Publish this automation/);
  });

  it("switches on once published", async () => {
    const saved = await automation();
    await publish.call({ automationId: saved.id, activate: true }, OWNER);
    const [row] = await db().select().from(automations).where(eq(automations.id, saved.id));
    expect(row!.status).toBe("active");
  });

  it("refuses a cooldown re-entry rule with no number of days", async () => {
    await expect(automation({ reentry: "cooldown" })).rejects.toThrow(/number of days/);
  });

  it("refuses a scheduled automation with no schedule", async () => {
    await expect(
      automation({ triggerKind: "schedule", eventPattern: null }),
    ).rejects.toThrow(/needs a schedule/);
  });

  it("validates a graph without saving anything", async () => {
    const result = await validate.call(
      {
        triggerKind: "event",
        graph: {
          entry: "a",
          maxSteps: 10,
          nodes: [{ kind: "call", id: "a", verb: "nope.missing", params: {}, next: null }],
        },
      },
      OWNER,
    );
    expect(result.ok).toBe(false);
    expect(await db().select().from(automations)).toHaveLength(0);
  });

  it("lists automations by status", async () => {
    const saved = await automation();
    await publish.call({ automationId: saved.id, activate: true }, OWNER);
    await saveAutomation.call(
      { name: "Second", eventPattern: "contact.created", draftGraph: SIMPLE },
      OWNER,
    );
    expect(await listAutomations.call({ status: "active" }, OWNER)).toHaveLength(1);
    expect(await listAutomations.call({ status: "draft" }, OWNER)).toHaveLength(1);
  });

  it("accepts a graph mixing a prompt step with deterministic ones", async () => {
    // The shape §4.17 is built around: one graph, both kinds of step.
    const saved = await automation({
      draftGraph: {
        entry: "wait",
        maxSteps: 20,
        nodes: [
          { kind: "wait", id: "wait", minutes: 2880, next: "draft" },
          {
            kind: "prompt",
            id: "draft",
            brief: "Write a short, warm win-back note.",
            outputKey: "note",
            next: "gate",
          },
          { kind: "gate", id: "gate", reason: "Read it before it goes", next: "record" },
          { kind: "call", id: "record", verb: "contacts.note", params: { body: "Win-back sent" }, next: null },
        ],
      },
    });
    const published = await publish.call({ automationId: saved.id }, OWNER);
    expect(published.version).toBe(1);
  });
});
