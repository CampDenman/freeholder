// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Playbooks: reusable work with a trigger (C4.08, MASTER.md §40).
//
// A playbook is data — a brief, its parameters, what starts it, and the
// ceilings work from it must respect. That it is data is the point: §40 wants
// playbooks shareable long before a marketplace exists, so the export here is
// a plain document with no credentials, no ids and no ambient authority, and
// the import is an ordinary owner-authenticated write.
//
// Two safety rules are structural rather than optional:
//   1. A playbook's autonomy ceiling only ever *lowers* what its agent may do.
//   2. Event-triggered work never interpolates the payload into the brief.
//      The brief is the owner's words; the payload is untrusted data, and it
//      travels in the task's input where §40's untrusted framing applies.
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { listed, row, timestamp, uuid } from "@/core/contract";
import { violates } from "@/core/db/errors";
import {
  defineService,
  ServiceError,
  type Actor,
  type ServiceContext,
} from "@/core/service";
import { agentPlaybooks, agentPlaybookVersions } from "@/core/agents/schema";
import { assertSchedule, nextOccurrence, scheduleZone } from "@/core/agents/cron";
import { createTask } from "@/core/agents/service";
import {
  parseParamsSchema,
  playbookParamsSchema,
  renderBrief,
  validateParamValues,
} from "@/core/agents/playbook-params";

const AUTONOMY = ["suggest", "approve", "autonomous"] as const;
const TRIGGERS = ["manual", "schedule", "event"] as const;

/** `contact.created`, or a family like `catalog.*`. */
const EVENT_PATTERN = /^[a-z][a-zA-Z0-9]*(\.[a-zA-Z0-9*]+)+$/;

function refuseAgents(actor: Actor, verb: string): void {
  // §40's envelope: an agent that can write playbooks can write its own
  // instructions, which is a ceiling that is not a ceiling.
  if (actor.kind === "agent") {
    throw new ServiceError(
      "permission",
      `An agent may not ${verb}. Playbooks are the owner's instructions.`,
    );
  }
}

const playbookRow = row({
  id: uuid,
  name: z.string(),
  description: z.string(),
  briefTemplate: z.string(),
  defaultAgentId: uuid.nullable(),
  paramsSchema: z.unknown(),
  trigger: z.enum(TRIGGERS),
  scheduleCron: z.string().nullable(),
  timezone: z.string().nullable(),
  nextRunAt: timestamp.nullable(),
  lastRunAt: timestamp.nullable(),
  catchUp: z.boolean(),
  lastOutcome: z.string().nullable(),
  eventPattern: z.string().nullable(),
  enabled: z.boolean(),
  version: z.number().int(),
  autonomyCeiling: z.enum(AUTONOMY).nullable(),
  budgetCents: z.number().int().nullable(),
  createdAt: timestamp,
  updatedAt: timestamp,
});

/** The portable document: no ids, no credentials, no bound agent. */
const playbookDocument = z.object({
  freeholderPlaybook: z.literal(1),
  name: z.string().trim().min(1).max(120),
  description: z.string().max(2_000).default(""),
  briefTemplate: z.string().min(1).max(50_000),
  paramsSchema: playbookParamsSchema.default({ params: [] }),
  trigger: z.enum(TRIGGERS).default("manual"),
  scheduleCron: z.string().max(120).nullish(),
  eventPattern: z.string().max(200).nullish(),
  autonomyCeiling: z.enum(AUTONOMY).nullish(),
  budgetCents: z.number().int().min(0).max(10_000_000).nullish(),
});

const definition = {
  description: z.string().max(2_000).default(""),
  briefTemplate: z.string().min(1).max(50_000),
  defaultAgentId: z.uuid().nullish(),
  paramsSchema: playbookParamsSchema.default({ params: [] }),
  trigger: z.enum(TRIGGERS).default("manual"),
  scheduleCron: z.string().trim().max(120).nullish(),
  eventPattern: z.string().trim().max(200).nullish(),
  autonomyCeiling: z.enum(AUTONOMY).nullish(),
  budgetCents: z.number().int().min(0).max(10_000_000).nullish(),
  enabled: z.boolean().default(true),
};

/**
 * A trigger has to carry what it needs to fire, or it never will.
 *
 * For a schedule that means the first occurrence is computed here and stored
 * (C4.14). A playbook that said "every weekday at seven" and sat with an empty
 * `next_run_at` would be switched on, look scheduled, and never run — which is
 * exactly the failure an owner cannot debug from the screen.
 */
async function checkTrigger(input: {
  trigger: "manual" | "schedule" | "event";
  scheduleCron?: string | null;
  eventPattern?: string | null;
  timezone?: string | null;
}): Promise<Date | null> {
  if (input.trigger === "schedule") {
    if (!input.scheduleCron) {
      throw new ServiceError(
        "validation",
        "A scheduled playbook needs a five-field cron expression, such as 0 9 * * 1.",
      );
    }
    const timezone = await scheduleZone({ timezone: input.timezone ?? null });
    assertSchedule(input.scheduleCron, timezone);
    return nextOccurrence(input.scheduleCron, timezone, new Date());
  }
  if (input.trigger === "event") {
    if (!input.eventPattern || !EVENT_PATTERN.test(input.eventPattern)) {
      throw new ServiceError(
        "validation",
        "An event playbook needs an event name such as contact.created, or a family such as catalog.*.",
      );
    }
  }
  // A playbook that stops being scheduled stops having a next run, rather
  // than keeping a timestamp nothing will ever read.
  return null;
}

async function writeVersion(
  ctx: ServiceContext,
  playbookId: string,
  version: number,
  briefTemplate: string,
  paramsSchema: unknown,
  note: string | undefined,
): Promise<void> {
  await ctx.tx.insert(agentPlaybookVersions).values({
    playbookId,
    version,
    briefTemplate,
    paramsSchema: paramsSchema ?? {},
    note: note ?? null,
    createdBy: ctx.actor.kind === "user" ? ctx.actor.userId : null,
  });
}

export const listPlaybooks = defineService({
  name: "agents.playbooks",
  summary: "Reusable briefs and what starts them.",
  kind: "query",
  permission: "scoped",
  input: z.object({}),
  output: listed(playbookRow),
  handler: (_input, ctx) =>
    ctx.tx.select().from(agentPlaybooks).orderBy(asc(agentPlaybooks.name)),
});

export const getPlaybook = defineService({
  name: "agents.playbook",
  summary: "One playbook, with the history of its wording.",
  kind: "query",
  permission: "scoped",
  input: z.object({ id: z.uuid() }),
  output: playbookRow
    .extend({
      versions: listed(
        row({
          version: z.number().int(),
          briefTemplate: z.string(),
          note: z.string().nullable(),
          createdBy: uuid.nullable(),
          createdAt: timestamp,
        }),
      ),
    })
    .nullable(),
  handler: async (input, ctx) => {
    const [playbook] = await ctx.tx
      .select()
      .from(agentPlaybooks)
      .where(eq(agentPlaybooks.id, input.id))
      .limit(1);
    if (!playbook) return null;
    const versions = await ctx.tx
      .select({
        version: agentPlaybookVersions.version,
        briefTemplate: agentPlaybookVersions.briefTemplate,
        note: agentPlaybookVersions.note,
        createdBy: agentPlaybookVersions.createdBy,
        createdAt: agentPlaybookVersions.createdAt,
      })
      .from(agentPlaybookVersions)
      .where(eq(agentPlaybookVersions.playbookId, playbook.id))
      .orderBy(desc(agentPlaybookVersions.version));
    return { ...playbook, versions };
  },
});

export const createPlaybook = defineService({
  name: "agents.createPlaybook",
  summary: "Write a reusable brief and say what starts it.",
  kind: "mutation",
  permission: "scoped",
  agentCallable: false,
  input: z.object({
    name: z.string().trim().min(1).max(120),
    note: z.string().trim().max(500).optional(),
    ...definition,
  }),
  output: playbookRow,
  handler: async (input, ctx) => {
    refuseAgents(ctx.actor, "write a playbook");
    const nextRunAt = await checkTrigger(input);
    const { note, ...values } = input;
    const [created] = await ctx.tx
      .insert(agentPlaybooks)
      .values({
        ...values,
        paramsSchema: values.paramsSchema,
        nextRunAt,
        version: 1,
      })
      .returning()
      .catch((error: unknown) => {
        if (violates(error, "agent_playbooks_name_idx")) {
          throw new ServiceError(
            "conflict",
            `There is already a playbook called "${input.name}".`,
          );
        }
        throw error;
      });
    await writeVersion(
      ctx,
      created!.id,
      1,
      created!.briefTemplate,
      created!.paramsSchema,
      note,
    );
    ctx.setSubject("agent_playbook", created!.id);
    ctx.queueEvent("agentPlaybook.created", { id: created!.id, name: created!.name });
    return created!;
  },
});

export const updatePlaybook = defineService({
  name: "agents.updatePlaybook",
  summary: "Change a playbook. Changing its wording writes a new version.",
  kind: "mutation",
  permission: "scoped",
  agentCallable: false,
  input: z.object({
    id: z.uuid(),
    name: z.string().trim().min(1).max(120).optional(),
    note: z.string().trim().max(500).optional(),
    description: z.string().max(2_000).optional(),
    briefTemplate: z.string().min(1).max(50_000).optional(),
    defaultAgentId: z.uuid().nullish(),
    paramsSchema: playbookParamsSchema.optional(),
    trigger: z.enum(TRIGGERS).optional(),
    scheduleCron: z.string().trim().max(120).nullish(),
    eventPattern: z.string().trim().max(200).nullish(),
    autonomyCeiling: z.enum(AUTONOMY).nullish(),
    budgetCents: z.number().int().min(0).max(10_000_000).nullish(),
    enabled: z.boolean().optional(),
  }),
  output: playbookRow,
  handler: async (input, ctx) => {
    refuseAgents(ctx.actor, "change a playbook");
    const { id, note, ...changes } = input;
    if (Object.keys(changes).length === 0) {
      throw new ServiceError("validation", "agents.updatePlaybook: nothing to change");
    }
    const [before] = await ctx.tx
      .select()
      .from(agentPlaybooks)
      .where(eq(agentPlaybooks.id, id))
      .limit(1);
    if (!before) throw new ServiceError("not_found", "No such playbook.");

    const scheduleCron =
      changes.scheduleCron === undefined ? before.scheduleCron : changes.scheduleCron;
    const trigger = changes.trigger ?? before.trigger;
    const nextRunAt = await checkTrigger({
      trigger,
      scheduleCron,
      eventPattern:
        changes.eventPattern === undefined ? before.eventPattern : changes.eventPattern,
      timezone: before.timezone,
    });
    // An unchanged schedule keeps the cursor it was already counting down to;
    // rewriting it here would push every window forward on every edit.
    const scheduleChanged =
      trigger !== before.trigger || scheduleCron !== before.scheduleCron;

    // Only the *wording* is versioned. Renaming a playbook or pausing it does
    // not change the instructions a past task was given, so it does not
    // deserve a version an owner has to read past.
    const rewording =
      (changes.briefTemplate !== undefined &&
        changes.briefTemplate !== before.briefTemplate) ||
      (changes.paramsSchema !== undefined &&
        JSON.stringify(changes.paramsSchema) !== JSON.stringify(before.paramsSchema));
    const version = rewording ? before.version + 1 : before.version;

    const [updated] = await ctx.tx
      .update(agentPlaybooks)
      .set({
        ...changes,
        version,
        ...(scheduleChanged ? { nextRunAt } : {}),
      })
      .where(eq(agentPlaybooks.id, id))
      .returning()
      .catch((error: unknown) => {
        if (violates(error, "agent_playbooks_name_idx")) {
          throw new ServiceError("conflict", "Another playbook already has that name.");
        }
        throw error;
      });
    if (rewording) {
      await writeVersion(
        ctx,
        id,
        version,
        updated!.briefTemplate,
        updated!.paramsSchema,
        note,
      );
    }
    ctx.setSubject("agent_playbook", id);
    ctx.queueEvent("agentPlaybook.updated", { id, name: updated!.name, version });
    return updated!;
  },
});

export const deletePlaybook = defineService({
  name: "agents.deletePlaybook",
  summary: "Remove a playbook. Work it already created is untouched.",
  kind: "mutation",
  permission: "scoped",
  agentCallable: false,
  writeClass: "destructive",
  input: z.object({ id: z.uuid() }),
  output: z.object({ id: uuid }),
  handler: async (input, ctx) => {
    refuseAgents(ctx.actor, "delete a playbook");
    const [removed] = await ctx.tx
      .delete(agentPlaybooks)
      .where(eq(agentPlaybooks.id, input.id))
      .returning({ id: agentPlaybooks.id });
    if (!removed) throw new ServiceError("not_found", "No such playbook.");
    ctx.setSubject("agent_playbook", removed.id);
    ctx.queueEvent("agentPlaybook.deleted", { id: removed.id });
    return removed;
  },
});

/**
 * Turn a playbook into one task.
 *
 * `source` and `sourceRef` record which playbook and which *version* produced
 * the work, so a task can always be read against the instructions it was
 * actually given rather than the ones the playbook carries today.
 */
async function startFromPlaybook(
  ctx: ServiceContext,
  playbook: typeof agentPlaybooks.$inferSelect,
  options: {
    source: "human" | "schedule" | "event";
    values: Record<string, unknown>;
    payload?: Record<string, unknown>;
    sourceRef?: string;
  },
): Promise<{ taskId: string; brief: string }> {
  if (!playbook.enabled) {
    throw new ServiceError("conflict", `"${playbook.name}" is switched off.`);
  }
  const params = parseParamsSchema(playbook.paramsSchema);
  // An event payload is *never* interpolated into the brief: the brief is the
  // owner's instruction and the payload is untrusted data. It travels in the
  // task's input instead, where §40's untrusted framing quotes it.
  const values =
    options.source === "event" ? {} : validateParamValues(params, options.values);
  const brief = renderBrief(playbook.briefTemplate, values);
  const created = await ctx.call(createTask, {
    title: playbook.name,
    brief,
    input: options.source === "event" ? (options.payload ?? {}) : values,
    inputTrust: options.source === "event" ? "untrusted" : "owner",
    agentId: playbook.defaultAgentId ?? undefined,
    autonomyCeiling: playbook.autonomyCeiling ?? undefined,
    budgetCents: playbook.budgetCents ?? undefined,
    source: options.source,
    sourceRef: options.sourceRef ?? `playbook:${playbook.id}@v${playbook.version}`,
  });
  return { taskId: created.id, brief };
}

export const runPlaybook = defineService({
  name: "agents.runPlaybook",
  summary: "Start the work a playbook describes, now.",
  kind: "mutation",
  permission: "scoped",
  agentCallable: false,
  writeClass: "write",
  input: z.object({
    id: z.uuid(),
    params: z.record(z.string(), z.unknown()).default({}),
  }),
  output: row({ taskId: uuid, brief: z.string(), version: z.number().int() }),
  handler: async (input, ctx) => {
    refuseAgents(ctx.actor, "run a playbook");
    const [playbook] = await ctx.tx
      .select()
      .from(agentPlaybooks)
      .where(eq(agentPlaybooks.id, input.id))
      .limit(1);
    if (!playbook) throw new ServiceError("not_found", "No such playbook.");
    const started = await startFromPlaybook(ctx, playbook, {
      source: "human",
      values: input.params,
    });
    ctx.setSubject("agent_playbook", playbook.id);
    ctx.queueEvent("agentPlaybook.started", {
      id: playbook.id,
      taskId: started.taskId,
      version: playbook.version,
    });
    return { ...started, version: playbook.version };
  },
});

/**
 * Fire every enabled event playbook whose pattern matches.
 *
 * Called from the event listener rather than being one: matching is a query,
 * and keeping it callable makes it testable without publishing to the bus.
 */
export async function runEventPlaybooks(
  ctx: ServiceContext,
  eventName: string,
  payload: Record<string, unknown>,
): Promise<string[]> {
  const family = `${eventName.split(".")[0]!}.*`;
  const matches = await ctx.tx
    .select()
    .from(agentPlaybooks)
    .where(
      and(
        eq(agentPlaybooks.trigger, "event"),
        eq(agentPlaybooks.enabled, true),
        sql`${agentPlaybooks.eventPattern} in (${eventName}, ${family})`,
      ),
    );
  const started: string[] = [];
  for (const playbook of matches) {
    const run = await startFromPlaybook(ctx, playbook, {
      source: "event",
      values: {},
      payload,
      sourceRef: `playbook:${playbook.id}@v${playbook.version}:${eventName}`,
    });
    started.push(run.taskId);
  }
  return started;
}

/**
 * Start a playbook because its schedule said so (C4.14).
 *
 * A scheduled run takes the playbook's declared parameter defaults; there is
 * nobody at the keyboard to be asked, and a schedule that refused to run
 * because a parameter was optional would be a schedule that never ran.
 */
export async function startScheduledPlaybook(
  ctx: ServiceContext,
  playbook: typeof agentPlaybooks.$inferSelect,
): Promise<{ taskId: string; brief: string }> {
  return startFromPlaybook(ctx, playbook, {
    source: "schedule",
    values: {},
    sourceRef: `playbook:${playbook.id}@v${playbook.version}:schedule`,
  });
}

export const exportPlaybook = defineService({
  name: "agents.exportPlaybook",
  summary: "A playbook as a portable document, with no credentials in it.",
  kind: "query",
  permission: "scoped",
  input: z.object({ id: z.uuid() }),
  output: playbookDocument,
  handler: async (input, ctx) => {
    const [playbook] = await ctx.tx
      .select()
      .from(agentPlaybooks)
      .where(eq(agentPlaybooks.id, input.id))
      .limit(1);
    if (!playbook) throw new ServiceError("not_found", "No such playbook.");
    // Deliberately partial: no id, no default agent, no version history. A
    // playbook is instructions, and instructions travel; the worker that runs
    // them and the credential it holds belong to the instance, not the file.
    return {
      freeholderPlaybook: 1 as const,
      name: playbook.name,
      description: playbook.description,
      briefTemplate: playbook.briefTemplate,
      paramsSchema: { params: parseParamsSchema(playbook.paramsSchema) },
      trigger: playbook.trigger,
      scheduleCron: playbook.scheduleCron,
      eventPattern: playbook.eventPattern,
      autonomyCeiling: playbook.autonomyCeiling,
      budgetCents: playbook.budgetCents,
    };
  },
});

export const importPlaybook = defineService({
  name: "agents.importPlaybook",
  summary: "Add a playbook from a document somebody shared.",
  kind: "mutation",
  permission: "scoped",
  agentCallable: false,
  input: z.object({
    document: playbookDocument,
    /** Import under a different name when one already exists. */
    name: z.string().trim().min(1).max(120).optional(),
  }),
  output: playbookRow,
  handler: async (input, ctx) => {
    refuseAgents(ctx.actor, "import a playbook");
    const document = input.document;
    await checkTrigger(document);
    // An imported playbook arrives switched off and unassigned. Somebody
    // else's instructions should not start running against this business's
    // data because a file was opened — the owner turns it on deliberately.
    return ctx.call(createPlaybook, {
      name: input.name ?? document.name,
      description: document.description,
      briefTemplate: document.briefTemplate,
      paramsSchema: document.paramsSchema,
      trigger: document.trigger,
      scheduleCron: document.scheduleCron ?? undefined,
      eventPattern: document.eventPattern ?? undefined,
      autonomyCeiling: document.autonomyCeiling ?? undefined,
      budgetCents: document.budgetCents ?? undefined,
      enabled: false,
      note: "Imported.",
    });
  },
});

export default [
  listPlaybooks,
  getPlaybook,
  createPlaybook,
  updatePlaybook,
  deletePlaybook,
  runPlaybook,
  exportPlaybook,
  importPlaybook,
];
