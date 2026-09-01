// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Building, validating and versioning automations (MASTER.md §4.17, C9.01).
//
// C9.01 is the half that defines. Nothing here executes an automation — runs,
// steps, delays and the guardrails are C9.02 and C9.03, and this module is
// deliberately shippable before either: an owner can build a rule, see it
// refused for a real reason, publish it, and switch it on, and the worst thing
// that happens on an instance without the runtime is that it does not fire.
//
// Two rules from §4.17 decide the shape of this file.
//
//   "A version is immutable, and a run pins the one that produced it."
//   So `publish` writes a version and nothing edits one. The draft is a
//   separate, mutable column, because an owner building a canvas saves
//   constantly and most of those saves are not decisions.
//
//   "Every loop is bounded at validation, not at runtime."
//   So `publish` refuses a graph `validateGraph` rejects. Validation is not a
//   convenience for the editor here; it is the guarantee.
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { listed, row, uuid as uuidSchema } from "@/core/contract";
import { defineService, ServiceError, type ServiceContext } from "@/core/service";
import { automationVerb, automationVerbs } from "@/core/automations/verbs";
import { eventCatalogue, isDeclaredEvent } from "@/core/events/catalogue";
import { users } from "@/core/auth/schema";
// Core's own verbs, imported for the side effect of registering them. Core
// cannot import a module (§11), so something a module loads has to pull them
// in; the verbs themselves live in core because that is whose they are.
import "@/core/automations/core-verbs";
import {
  AUTOMATION_REENTRY,
  AUTOMATION_STATUSES,
  AUTOMATION_TRIGGERS,
  automationVersions,
  automations,
} from "./schema";
import { automationGraph, validateGraph, type GraphProblem } from "./graph";
// The runtime half (C9.02). Re-exported here because the manifest names one
// services module, and separate because defining an automation and running one
// are not the same subject.
export { runNow, wake, killRun, listRuns, inspectRun } from "./runtime";
import { inspectRun, killRun, listRuns, runNow, wake } from "./runtime";
// The guardrails as a service (C9.03). It exists because "would this be
// allowed?" is a real question an owner asks before switching an automation
// on — and because a decision this consequential should be inspectable from
// outside the runtime rather than only observable by its effects.
export { checkGuardrails } from "./guardrail-service";
import { checkGuardrails } from "./guardrail-service";

const automationRow = row({
  id: uuidSchema,
  name: z.string(),
  description: z.string(),
  triggerKind: z.enum(AUTOMATION_TRIGGERS),
  eventPattern: z.string().nullable(),
  scheduleCron: z.string().nullable(),
  timezone: z.string().nullable(),
  entrySegmentId: uuidSchema.nullable(),
  status: z.enum(AUTOMATION_STATUSES),
  currentVersionId: uuidSchema.nullable(),
  autonomyCeiling: z.enum(["suggest", "approve", "autonomous"]).nullable(),
  budgetMinor: z.number().int().nullable(),
  reentry: z.enum(AUTOMATION_REENTRY),
  cooldownDays: z.number().int().nullable(),
  updatedAt: z.date(),
});

const problemRow = row({ nodeId: z.string().nullable(), message: z.string() });

/**
 * Whether a run of this automation arrives with somebody attached.
 *
 * An event carries a contact often enough that a verb acting on one is
 * reasonable; a schedule or a manual run does not. Validation uses this to
 * refuse "tag the contact" on a nightly automation at save time rather than
 * letting it throw in six weeks at 3am.
 *
 * An **audience settles it either way** (§30, C7.17): an automation whose entry
 * condition is a segment is by definition about people, and `startRun` refuses
 * to start one without a contact — so a manual "send this to everyone in the
 * segment" rule may use contact verbs, and the refusal that made it impossible
 * was the validator disagreeing with the runtime rather than a real rule.
 */
function triggerHasContact(triggerKind: string, hasAudience: boolean): boolean {
  return triggerKind === "event" || hasAudience;
}

/** The verb keys installed right now, and which of them need a contact. */
function knownVerbs(): { verbs: Set<string>; verbsNeedingContact: Set<string> } {
  const all = automationVerbs();
  return {
    verbs: new Set(all.map((verb) => verb.key)),
    verbsNeedingContact: new Set(
      all.filter((verb) => verb.requiresContact).map((verb) => verb.key),
    ),
  };
}

/** Everything wrong with a candidate graph, given what is installed. */
function problemsFor(
  graph: unknown,
  triggerKind: string,
  hasAudience: boolean,
): GraphProblem[] {
  const parsed = automationGraph.safeParse(graph);
  if (!parsed.success) {
    return parsed.error.issues.map((issue) => ({
      nodeId: null,
      message: `${issue.path.join(".") || "graph"}: ${issue.message}`,
    }));
  }
  const known = knownVerbs();
  return validateGraph(parsed.data, {
    ...known,
    triggerHasContact: triggerHasContact(triggerKind, hasAudience),
  });
}

async function actingUserId(ctx: ServiceContext): Promise<string | null> {
  if (ctx.actor.kind !== "user") return null;
  const [user] = await ctx.tx
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, ctx.actor.userId))
    .limit(1);
  return user?.id ?? null;
}

/* ------------------------------------------------------------ the palette */

export const triggers = defineService({
  name: "automations.triggers",
  summary: "Every event an automation can be triggered by (§4.17).",
  kind: "query",
  permission: "scoped",
  input: z.object({}),
  output: listed(row({ name: z.string(), module: z.string() })),
  // Read from the manifests rather than a hand-kept list: a constant is wrong
  // the first time a module adds an event, and wrong silently.
  handler: () => Promise.resolve(eventCatalogue()),
});

export const verbs = defineService({
  name: "automations.verbs",
  summary: "Everything an automation is allowed to do, from installed modules.",
  kind: "query",
  permission: "scoped",
  input: z.object({}),
  output: listed(
    row({
      key: z.string(),
      module: z.string(),
      label: z.string(),
      summary: z.string(),
      effect: z.enum(["record", "messages", "money", "destructive"]),
      requiresContact: z.boolean(),
    }),
  ),
  handler: () =>
    Promise.resolve(
      automationVerbs().map((verb) => ({
        key: verb.key,
        module: verb.module,
        label: verb.label,
        summary: verb.summary,
        effect: verb.effect,
        requiresContact: verb.requiresContact,
      })),
    ),
});

/* -------------------------------------------------------------- building */

export const saveAutomation = defineService({
  name: "automations.save",
  writeClass: "write",
  summary: "Create or change an automation, including its draft graph.",
  kind: "mutation",
  permission: "scoped",
  input: z
    .object({
      id: uuidSchema.optional(),
      name: z.string().trim().min(1).max(120),
      description: z.string().trim().max(2000).default(""),
      triggerKind: z.enum(AUTOMATION_TRIGGERS).default("event"),
      eventPattern: z.string().trim().max(120).nullish(),
      scheduleCron: z.string().trim().max(120).nullish(),
      timezone: z.string().trim().max(60).nullish(),
      entrySegmentId: uuidSchema.nullish(),
      autonomyCeiling: z.enum(["suggest", "approve", "autonomous"]).nullish(),
      budgetMinor: z.number().int().min(0).nullish(),
      reentry: z.enum(AUTOMATION_REENTRY).default("once"),
      cooldownDays: z.number().int().min(1).max(3650).nullish(),
      /** The work in progress. Saved as-is; only `publish` insists it is valid. */
      draftGraph: z.unknown().optional(),
    })
    .refine((v) => v.triggerKind !== "event" || Boolean(v.eventPattern), {
      message: "An event automation needs an event to listen for.",
      path: ["eventPattern"],
    })
    .refine((v) => v.triggerKind !== "schedule" || Boolean(v.scheduleCron), {
      message: "A scheduled automation needs a schedule.",
      path: ["scheduleCron"],
    })
    .refine((v) => v.reentry !== "cooldown" || Boolean(v.cooldownDays), {
      message: "A cooldown re-entry rule needs a number of days.",
      path: ["cooldownDays"],
    }),
  output: automationRow,
  handler: async (input, ctx) => {
    // Refused here rather than at publish: an owner who picks an event that no
    // installed module emits has almost always mistyped it, and finding out at
    // publish means re-reading a canvas they already believed was finished.
    if (input.triggerKind === "event" && input.eventPattern) {
      if (!isDeclaredEvent(input.eventPattern)) {
        throw new ServiceError(
          "validation",
          `Nothing installed emits "${input.eventPattern}".`,
        );
      }
    }

    const values = {
      name: input.name,
      description: input.description,
      triggerKind: input.triggerKind,
      eventPattern: input.eventPattern ?? null,
      scheduleCron: input.scheduleCron ?? null,
      timezone: input.timezone ?? null,
      entrySegmentId: input.entrySegmentId ?? null,
      autonomyCeiling: input.autonomyCeiling ?? null,
      budgetMinor: input.budgetMinor ?? null,
      reentry: input.reentry,
      cooldownDays: input.cooldownDays ?? null,
      ...(input.draftGraph === undefined ? {} : { draftGraph: input.draftGraph }),
    };

    if (input.id) {
      const [updated] = await ctx.tx
        .update(automations)
        .set(values)
        .where(eq(automations.id, input.id))
        .returning();
      if (!updated) throw new ServiceError("not_found", "There is no such automation.");
      ctx.setSubject("automation", updated.id);
      return updated;
    }

    const [created] = await ctx.tx
      .insert(automations)
      .values({ ...values, createdByUserId: await actingUserId(ctx) })
      .returning();
    ctx.setSubject("automation", created!.id);
    ctx.queueEvent("automation.created", { automationId: created!.id });
    return created!;
  },
});

/**
 * What is wrong with a graph, without saving anything.
 *
 * A query, so the canvas can ask continuously. It reports *every* problem
 * rather than the first: an owner fixing a canvas one error per save is being
 * made to do the validator's work.
 */
export const validate = defineService({
  name: "automations.validate",
  summary: "Everything wrong with a graph, given what is installed (§4.17).",
  kind: "query",
  permission: "scoped",
  input: z.object({
    graph: z.unknown(),
    triggerKind: z.enum(AUTOMATION_TRIGGERS).default("event"),
    /** An audience makes a run about somebody, whatever the trigger (C7.17). */
    entrySegmentId: uuidSchema.nullish(),
  }),
  output: row({ ok: z.boolean(), problems: z.array(problemRow) }),
  handler: (input) => {
    const problems = problemsFor(input.graph, input.triggerKind, Boolean(input.entrySegmentId));
    return Promise.resolve({ ok: problems.length === 0, problems });
  },
});

/**
 * Turn the draft into a version, and refuse if it does not hold up.
 *
 * §4.17: "A graph that can express an unbounded loop is refused when it is
 * saved." This is that refusal. Publishing is also the only thing that writes
 * a version, which is what keeps the history readable — a version per keystroke
 * would bury the change that matters.
 */
export const publish = defineService({
  name: "automations.publish",
  writeClass: "write",
  summary: "Publish the draft as a new immutable version.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    automationId: uuidSchema,
    note: z.string().trim().max(2000).nullish(),
    /** Switch it on in the same step, once it is known to be valid. */
    activate: z.boolean().default(false),
  }),
  output: row({ versionId: uuidSchema, version: z.number().int(), status: z.enum(AUTOMATION_STATUSES) }),
  handler: async (input, ctx) => {
    const [automation] = await ctx.tx
      .select()
      .from(automations)
      .where(eq(automations.id, input.automationId));
    if (!automation) throw new ServiceError("not_found", "There is no such automation.");
    if (automation.draftGraph === null || automation.draftGraph === undefined) {
      throw new ServiceError("conflict", "There is nothing drafted to publish.");
    }

    const problems = problemsFor(
      automation.draftGraph,
      automation.triggerKind,
      Boolean(automation.entrySegmentId),
    );
    if (problems.length > 0) {
      throw new ServiceError(
        "validation",
        `This automation cannot be switched on yet: ${problems
          .map((problem) => problem.message)
          .join(" ")}`,
      );
    }

    // The number comes from the database, not the caller. Two publishes racing
    // would otherwise both compute the same version and one would win silently.
    const [last] = await ctx.tx
      .select({ version: automationVersions.version })
      .from(automationVersions)
      .where(eq(automationVersions.automationId, automation.id))
      .orderBy(desc(automationVersions.version))
      .limit(1);

    const [created] = await ctx.tx
      .insert(automationVersions)
      .values({
        automationId: automation.id,
        version: (last?.version ?? 0) + 1,
        graph: automation.draftGraph,
        note: input.note ?? null,
        // Copied, not read through: an automation moved from an event to a
        // schedule next week does not make this version's runs scheduled.
        triggerKind: automation.triggerKind,
        eventPattern: automation.eventPattern,
        scheduleCron: automation.scheduleCron,
        // And the audience with it (§30, C7.17): narrowing who may enter is
        // an edit like any other, and last month's runs were not narrowed.
        entrySegmentId: automation.entrySegmentId,
        createdByUserId: await actingUserId(ctx),
      })
      .returning();

    const status = input.activate ? ("active" as const) : automation.status;
    await ctx.tx
      .update(automations)
      .set({ currentVersionId: created!.id, status })
      .where(eq(automations.id, automation.id));

    ctx.setSubject("automation", automation.id);
    ctx.queueEvent("automation.published", {
      automationId: automation.id,
      versionId: created!.id,
      version: created!.version,
    });
    return { versionId: created!.id, version: created!.version, status };
  },
});

export const setStatus = defineService({
  name: "automations.setStatus",
  writeClass: "write",
  summary: "Switch an automation on, pause it, or archive it.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    automationId: uuidSchema,
    status: z.enum(["active", "paused", "archived"]),
  }),
  output: row({ automationId: uuidSchema, status: z.enum(AUTOMATION_STATUSES) }),
  handler: async (input, ctx) => {
    const [automation] = await ctx.tx
      .select()
      .from(automations)
      .where(eq(automations.id, input.automationId));
    if (!automation) throw new ServiceError("not_found", "There is no such automation.");
    // Switching on something that has never been published would be an
    // automation that is "active" and cannot run, which is a state an owner
    // would reasonably read as working.
    if (input.status === "active" && !automation.currentVersionId) {
      throw new ServiceError("conflict", "Publish this automation before switching it on.");
    }
    await ctx.tx
      .update(automations)
      .set({ status: input.status })
      .where(eq(automations.id, automation.id));
    ctx.setSubject("automation", automation.id);
    ctx.queueEvent("automation.statusChanged", {
      automationId: automation.id,
      status: input.status,
    });
    return { automationId: automation.id, status: input.status };
  },
});

/* --------------------------------------------------------------- reading */

export const listAutomations = defineService({
  name: "automations.list",
  summary: "Automations, newest change first.",
  kind: "query",
  permission: "scoped",
  input: z.object({
    status: z.enum(AUTOMATION_STATUSES).optional(),
    triggerKind: z.enum(AUTOMATION_TRIGGERS).optional(),
    limit: z.number().int().min(1).max(200).default(50),
  }),
  output: listed(automationRow),
  handler: (input, ctx) =>
    ctx.tx
      .select()
      .from(automations)
      .where(
        and(
          input.status ? eq(automations.status, input.status) : undefined,
          input.triggerKind ? eq(automations.triggerKind, input.triggerKind) : undefined,
        ),
      )
      .orderBy(desc(automations.updatedAt))
      .limit(input.limit),
});

export const getAutomation = defineService({
  name: "automations.get",
  summary: "One automation, with its draft and its current version.",
  kind: "query",
  permission: "scoped",
  input: z.object({ automationId: uuidSchema }),
  output: row({
    automation: automationRow,
    draftGraph: z.unknown().nullable(),
    currentGraph: z.unknown().nullable(),
    problems: z.array(problemRow),
  }),
  handler: async (input, ctx) => {
    const [automation] = await ctx.tx
      .select()
      .from(automations)
      .where(eq(automations.id, input.automationId));
    if (!automation) throw new ServiceError("not_found", "There is no such automation.");

    const [current] = automation.currentVersionId
      ? await ctx.tx
          .select({ graph: automationVersions.graph })
          .from(automationVersions)
          .where(eq(automationVersions.id, automation.currentVersionId))
      : [];

    return {
      automation,
      draftGraph: automation.draftGraph ?? null,
      currentGraph: current?.graph ?? null,
      // Reported on read so a canvas opened months later says what is wrong
      // *now* — a module removed since publishing takes its verbs with it, and
      // an automation quietly referring to one is worth seeing before it runs.
      problems:
        automation.draftGraph === null || automation.draftGraph === undefined
          ? []
          : problemsFor(
              automation.draftGraph,
              automation.triggerKind,
              Boolean(automation.entrySegmentId),
            ),
    };
  },
});

export const versions = defineService({
  name: "automations.versions",
  summary: "Every published version of an automation, newest first.",
  kind: "query",
  permission: "scoped",
  input: z.object({ automationId: uuidSchema }),
  output: listed(
    row({
      id: uuidSchema,
      version: z.number().int(),
      note: z.string().nullable(),
      triggerKind: z.enum(AUTOMATION_TRIGGERS),
      eventPattern: z.string().nullable(),
      createdAt: z.date(),
    }),
  ),
  handler: (input, ctx) =>
    ctx.tx
      .select({
        id: automationVersions.id,
        version: automationVersions.version,
        note: automationVersions.note,
        triggerKind: automationVersions.triggerKind,
        eventPattern: automationVersions.eventPattern,
        createdAt: automationVersions.createdAt,
      })
      .from(automationVersions)
      .where(eq(automationVersions.automationId, input.automationId))
      .orderBy(desc(automationVersions.version)),
});

export const versionGraph = defineService({
  name: "automations.versionGraph",
  summary: "The graph exactly as one published version holds it.",
  kind: "query",
  permission: "scoped",
  input: z.object({ versionId: uuidSchema }),
  output: row({ versionId: uuidSchema, version: z.number().int(), graph: z.unknown() }),
  handler: async (input, ctx) => {
    const [found] = await ctx.tx
      .select()
      .from(automationVersions)
      .where(eq(automationVersions.id, input.versionId));
    if (!found) throw new ServiceError("not_found", "There is no such version.");
    return { versionId: found.id, version: found.version, graph: found.graph };
  },
});

/**
 * Restore an earlier version into the draft.
 *
 * Not "revert the automation" — it fills the draft, and publishing it writes a
 * *new* version. Rolling back by mutating history would break the one property
 * the versions exist for: that a run can be read against the rules it was
 * actually given.
 */
export const restoreVersion = defineService({
  name: "automations.restoreVersion",
  writeClass: "write",
  summary: "Copy an earlier version back into the draft.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({ versionId: uuidSchema }),
  output: row({ automationId: uuidSchema, fromVersion: z.number().int() }),
  handler: async (input, ctx) => {
    const [found] = await ctx.tx
      .select()
      .from(automationVersions)
      .where(eq(automationVersions.id, input.versionId));
    if (!found) throw new ServiceError("not_found", "There is no such version.");
    await ctx.tx
      .update(automations)
      .set({ draftGraph: found.graph })
      .where(eq(automations.id, found.automationId));
    ctx.setSubject("automation", found.automationId);
    return { automationId: found.automationId, fromVersion: found.version };
  },
});

export { automationVerb };

export default [
  triggers,
  verbs,
  saveAutomation,
  validate,
  publish,
  setStatus,
  listAutomations,
  getAutomation,
  versions,
  versionGraph,
  restoreVersion,
  // C9.02.
  runNow,
  wake,
  killRun,
  listRuns,
  inspectRun,
  // C9.03.
  checkGuardrails,
];
