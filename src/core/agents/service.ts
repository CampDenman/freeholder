// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The agent orchestration layer (MASTER.md §40), stage 1: the model.
//
// Configuration here is owner-only *and closed to agents entirely*, which is
// the same rule that stops an API key minting API keys and a key pointing a
// webhook wherever it likes. §40 states the reason plainly: an agent that can
// create an agent has no ceiling.
//
// Tasks are the exception. An agent creating child tasks is decomposition —
// the behaviour this layer exists to support — so `agents.createTask` admits
// an agent actor, under two constraints it cannot escape: a child inherits its
// parent's trust level and can never be more autonomous than its parent.
import { z } from "zod";
import { and, asc, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import { listed, row, timestamp, uuid } from "@/core/contract";
import {
  agentConnections,
  agentRuns,
  agents,
  agentSpend,
  agentSteps,
  agentTasks,
} from "@/core/agents/schema";
import { createApiKey } from "@/core/apikeys/service";
import { violates } from "@/core/db/errors";
import { WORKFORCE_ADAPTER_IDS } from "@/adapters/agent/workforce-types";
import {
  actorString,
  defineService,
  redact,
  ServiceError,
  type Actor,
  type Tx,
} from "@/core/service";

const AUTONOMY = ["suggest", "approve", "autonomous"] as const;
type Autonomy = (typeof AUTONOMY)[number];

const connectionRow = row({
  id: uuid,
  name: z.string(),
  kind: z.enum(["managed", "inbound"]),
  adapter: z.string().nullable(),
  model: z.string().nullable(),
  credentialRef: z.string().nullable(),
  baseUrl: z.string().nullable(),
  maxConcurrency: z.number().int(),
  status: z.enum(["active", "paused"]),
  lastSeenAt: timestamp.nullable(),
  lastError: z.string().nullable(),
  createdBy: uuid.nullable(),
  createdAt: timestamp,
  updatedAt: timestamp,
});

const agentRow = row({
  id: uuid,
  connectionId: uuid,
  name: z.string(),
  role: z.string(),
  instructions: z.string(),
  apiKeyId: uuid.nullable(),
  toolScopes: z.array(z.string()),
  autonomy: z.enum(AUTONOMY),
  maxConcurrency: z.number().int(),
  budgetCents: z.number().int(),
  budgetPeriod: z.enum(["day", "week", "month"]),
  status: z.enum(["active", "paused"]),
  createdAt: timestamp,
  updatedAt: timestamp,
});

export const TASK_STATUSES = [
  "queued",
  "running",
  "waiting_approval",
  "blocked",
  "done",
  "failed",
  "needs_attention",
  "cancelled",
] as const;

const taskStatus = z.enum(TASK_STATUSES);

const taskRow = row({
  id: uuid,
  parentId: uuid.nullable(),
  rootId: uuid,
  agentId: uuid.nullable(),
  title: z.string(),
  brief: z.string(),
  input: z.unknown(),
  inputTrust: z.enum(["owner", "system", "untrusted"]),
  status: taskStatus,
  priority: z.number().int(),
  dependsOn: z.array(uuid),
  dueAt: timestamp.nullable(),
  autonomyCeiling: z.enum(AUTONOMY).nullable(),
  budgetCents: z.number().int().nullable(),
  result: z.unknown().nullable(),
  failureReason: z.string().nullable(),
  attempts: z.number().int(),
  createdByActor: z.string(),
  source: z.enum(["human", "schedule", "event", "agent"]),
  sourceRef: z.string().nullable(),
  createdAt: timestamp,
  updatedAt: timestamp,
});

const runRow = row({
  id: uuid,
  taskId: uuid,
  agentId: uuid,
  attempt: z.number().int(),
  status: z.enum(["running", "done", "failed", "cancelled"]),
  startedAt: timestamp,
  endedAt: timestamp.nullable(),
  model: z.string().nullable(),
  tokensIn: z.number().int(),
  tokensOut: z.number().int(),
  costCents: z.number().int(),
  stopReason: z
    .enum(["done", "budget", "timeout", "refused", "error", "cancelled"])
    .nullable(),
  error: z.string().nullable(),
  leaseExpiresAt: timestamp.nullable(),
  createdAt: timestamp,
  updatedAt: timestamp,
});

const stepRow = row({
  id: uuid,
  runId: uuid,
  seq: z.number().int(),
  kind: z.enum(["message", "tool_call", "tool_result", "note"]),
  serviceName: z.string().nullable(),
  input: z.unknown().nullable(),
  output: z.unknown().nullable(),
  tokens: z.number().int(),
  durationMs: z.number().int().nullable(),
  error: z.string().nullable(),
  createdAt: timestamp,
});

/** Attempts at a task before it is parked for a person to look at. */
export const MAX_TASK_ATTEMPTS = 3;

/** Ordered, so "no higher than" is a comparison rather than a lookup table. */
const RANK: Record<Autonomy, number> = { suggest: 1, approve: 2, autonomous: 3 };

function redactStep<T extends { input: unknown; output: unknown }>(step: T): T {
  return { ...step, input: redact(step.input), output: redact(step.output) };
}

async function revokeRuns(tx: Tx, taskIds: string[], reason: string): Promise<number> {
  if (taskIds.length === 0) return 0;
  const ended = await tx
    .update(agentRuns)
    .set({
      status: "cancelled",
      stopReason: "cancelled",
      endedAt: sql`now()`,
      leaseExpiresAt: null,
      error: reason,
    })
    .where(and(inArray(agentRuns.taskId, taskIds), eq(agentRuns.status, "running")))
    .returning({ id: agentRuns.id });
  return ended.length;
}

function refuseAgents(actor: Actor, verb: string): void {
  if (actor.kind === "agent") {
    throw new ServiceError(
      "permission",
      `An agent cannot ${verb}. Sign in as the owner to manage your agents.`,
    );
  }
}

/**
 * The autonomy a task may actually run at.
 *
 * Three inputs, and the answer is the *lowest* of them: the agent's ceiling,
 * whatever the task asked for, and — if the input is untrusted — `suggest`.
 * §40 makes the direction the whole safety property, so it is one function
 * with one rule rather than a check repeated at each call site.
 */
export function effectiveAutonomy(
  agentCeiling: Autonomy,
  taskCeiling: Autonomy | null | undefined,
  inputTrust: "owner" | "system" | "untrusted",
): Autonomy {
  let level = agentCeiling;
  if (taskCeiling && RANK[taskCeiling] < RANK[level]) level = taskCeiling;
  if (inputTrust === "untrusted" && RANK[level] > RANK.suggest) {
    // A task whose input is a customer's message can never act by itself,
    // whatever anyone configured. This is the line prompt injection has to
    // cross to matter, and it is drawn in one place.
    level = "suggest";
  }
  return level;
}

/* ------------------------------------------------------------ connections */

export const listConnections = defineService({
  name: "agents.connections",
  summary: "Every agent runtime this site can reach.",
  kind: "query",
  permission: "scoped",
  input: z.object({}),
  output: listed(
    row({
      id: uuid,
      name: z.string(),
      kind: z.enum(["managed", "inbound"]),
      adapter: z.string().nullable(),
      model: z.string().nullable(),
      credentialRef: z.string().nullable(),
      maxConcurrency: z.number().int(),
      status: z.enum(["active", "paused"]),
      lastSeenAt: timestamp.nullable(),
      lastError: z.string().nullable(),
    }),
  ),
  handler: async (_input, ctx) =>
    ctx.tx
      .select({
        id: agentConnections.id,
        name: agentConnections.name,
        kind: agentConnections.kind,
        adapter: agentConnections.adapter,
        model: agentConnections.model,
        credentialRef: agentConnections.credentialRef,
        maxConcurrency: agentConnections.maxConcurrency,
        status: agentConnections.status,
        lastSeenAt: agentConnections.lastSeenAt,
        lastError: agentConnections.lastError,
      })
      .from(agentConnections)
      .orderBy(asc(agentConnections.name)),
});

export const connectAgentRuntime = defineService({
  name: "agents.connect",
  summary: "Add an agent runtime.",
  kind: "mutation",
  permission: "scoped",
  stepUp: true,
  input: z
    .object({
      name: z.string().min(1).max(80),
      kind: z.enum(["managed", "inbound"]),
      adapter: z.string().max(80).nullish(),
      model: z.string().max(120).nullish(),
      /** The *name* of an environment variable, never a key (§17). */
      credentialRef: z
        .string()
        .max(120)
        .regex(/^[A-Z][A-Z0-9_]*$/, {
          message: "give the name of an environment variable, such as ANTHROPIC_API_KEY",
        })
        .nullish(),
      baseUrl: z.url().max(500).nullish(),
      maxConcurrency: z.number().int().min(1).max(50).default(2),
    })
    .refine((v) => v.kind !== "managed" || Boolean(v.adapter), {
      message: "a managed connection needs an adapter to run the loop with",
      path: ["adapter"],
    })
    // A typo here would otherwise surface as a run failing days later. The
    // known family lives with the adapters, not in a second list here.
    .refine(
      (v) =>
        v.kind !== "managed" ||
        !v.adapter ||
        WORKFORCE_ADAPTER_IDS.includes(v.adapter as (typeof WORKFORCE_ADAPTER_IDS)[number]),
      {
        message: `the workforce adapters installed in this build are: ${WORKFORCE_ADAPTER_IDS.join(", ")}`,
        path: ["adapter"],
      },
    )
    .refine((v) => v.kind !== "managed" || v.adapter !== "openai" || Boolean(v.model), {
      message:
        "name the OpenAI model this connection should run — the platform does not guess one",
      path: ["model"],
    }),
  output: connectionRow,
  handler: async (input, ctx) => {
    refuseAgents(ctx.actor, "add a runtime");
    const [row] = await ctx.tx
      .insert(agentConnections)
      .values({
        ...input,
        createdBy: ctx.actor.kind === "user" ? ctx.actor.userId : null,
      })
      .returning()
      .catch((error: unknown) => {
        if (violates(error, "agent_connections_name_idx")) {
          throw new ServiceError(
            "conflict",
            `There is already a connection called "${input.name}".`,
          );
        }
        throw error;
      });

    ctx.setSubject("agent_connection", row!.id);
    ctx.queueEvent("agent.connected", { id: row!.id, name: row!.name });
    return row!;
  },
});

/* ---------------------------------------------------------------- workers */

export const listAgents = defineService({
  name: "agents.list",
  summary: "The workers this business has.",
  kind: "query",
  permission: "scoped",
  input: z.object({}),
  output: listed(
    row({
      id: uuid,
      name: z.string(),
      role: z.string(),
      connectionId: uuid,
      toolScopes: z.array(z.string()),
      autonomy: z.enum(AUTONOMY),
      maxConcurrency: z.number().int(),
      budgetCents: z.number().int(),
      budgetPeriod: z.enum(["day", "week", "month"]),
      status: z.enum(["active", "paused"]),
    }),
  ),
  handler: async (_input, ctx) =>
    ctx.tx
      .select({
        id: agents.id,
        name: agents.name,
        role: agents.role,
        connectionId: agents.connectionId,
        toolScopes: agents.toolScopes,
        autonomy: agents.autonomy,
        maxConcurrency: agents.maxConcurrency,
        budgetCents: agents.budgetCents,
        budgetPeriod: agents.budgetPeriod,
        status: agents.status,
      })
      .from(agents)
      .orderBy(asc(agents.name)),
});

/**
 * Hire a worker.
 *
 * It gets its own `ApiKey` in the same transaction. That is not bookkeeping:
 * it is what makes `actor = agent:<name>` true at the service layer, what lets
 * an owner revoke one worker without touching the others, and what makes a
 * confused agent's blast radius exactly its scopes.
 *
 * The token comes back once, for an *inbound* runtime to be configured with. A
 * managed agent never needs it — the platform constructs the actor in-process
 * — which is why nothing here stores it.
 */
export const hireAgent = defineService({
  name: "agents.hire",
  summary: "Create a worker with its own credential and scopes.",
  kind: "mutation",
  permission: "scoped",
  stepUp: true,
  input: z.object({
    connectionId: z.uuid(),
    name: z.string().min(1).max(80),
    role: z.string().min(1).max(200),
    instructions: z.string().max(20_000).default(""),
    toolScopes: z.array(z.string().min(1).max(120)).max(200).default([]),
    autonomy: z.enum(AUTONOMY).default("suggest"),
    maxConcurrency: z.number().int().min(1).max(20).default(1),
    budgetCents: z.number().int().min(0).max(10_000_000).default(0),
    budgetPeriod: z.enum(["day", "week", "month"]).default("month"),
  }),
  output: agentRow.extend({ token: z.string() }),
  handler: async (input, ctx) => {
    refuseAgents(ctx.actor, "hire an agent");

    const [connection] = await ctx.tx
      .select({ id: agentConnections.id })
      .from(agentConnections)
      .where(eq(agentConnections.id, input.connectionId))
      .limit(1);
    if (!connection) throw new ServiceError("not_found", "No such connection.");

    if (input.toolScopes.some((scope) => scope.startsWith("builder."))) {
      // §37 and §40 both insist on this: build authority is a separate grant,
      // and a worker that drafts emails must not also be able to change the
      // site. Refused here rather than filtered, so the owner learns it.
      throw new ServiceError(
        "validation",
        "Build authority (builder.*) is granted separately from a worker's scopes. See §37.",
      );
    }

    // Through the service, in this transaction, so the key's own audit row
    // exists and its scopes are validated against the registry once (§11).
    const key = await ctx.call(createApiKey, {
      name: `agent:${input.name}`,
      scopes: input.toolScopes,
    });

    const [row] = await ctx.tx
      .insert(agents)
      .values({
        connectionId: input.connectionId,
        name: input.name,
        role: input.role,
        instructions: input.instructions,
        apiKeyId: key.id,
        toolScopes: input.toolScopes,
        autonomy: input.autonomy,
        maxConcurrency: input.maxConcurrency,
        budgetCents: input.budgetCents,
        budgetPeriod: input.budgetPeriod,
      })
      .returning()
      .catch((error: unknown) => {
        if (violates(error, "agents_name_idx")) {
          throw new ServiceError(
            "conflict",
            `There is already an agent called "${input.name}".`,
          );
        }
        throw error;
      });

    ctx.setSubject("agent", row!.id);
    ctx.queueEvent("agent.hired", { id: row!.id, name: row!.name });
    return { ...row!, token: key.token };
  },
});

export const updateAgent = defineService({
  name: "agents.update",
  summary: "Change a worker's brief, autonomy, budget or status.",
  kind: "mutation",
  permission: "scoped",
  stepUp: true,
  input: z.object({
    id: z.uuid(),
    role: z.string().min(1).max(200).optional(),
    instructions: z.string().max(20_000).optional(),
    autonomy: z.enum(AUTONOMY).optional(),
    maxConcurrency: z.number().int().min(1).max(20).optional(),
    budgetCents: z.number().int().min(0).max(10_000_000).optional(),
    budgetPeriod: z.enum(["day", "week", "month"]).optional(),
    status: z.enum(["active", "paused"]).optional(),
  }),
  output: agentRow,
  handler: async (input, ctx) => {
    refuseAgents(ctx.actor, "change an agent");
    const { id, ...changes } = input;
    if (Object.keys(changes).length === 0) {
      throw new ServiceError("validation", "agents.update: nothing to change");
    }
    const [row] = await ctx.tx
      .update(agents)
      .set(changes)
      .where(eq(agents.id, id))
      .returning();
    if (!row) throw new ServiceError("not_found", "No such agent.");

    ctx.setSubject("agent", id);
    ctx.queueEvent("agent.updated", { id, name: row.name });
    return row;
  },
});

/**
 * Stop every agent at once (§40's kill switch).
 *
 * Separate from pausing one because it is the thing an owner reaches for when
 * something is going wrong, and hunting through a list to pause six workers is
 * not what that moment should require.
 */
export const pauseAllAgents = defineService({
  name: "agents.pauseAll",
  summary: "Pause every agent immediately.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({ paused: z.boolean().default(true) }),
  output: z.object({ changed: z.number().int() }),
  handler: async (input, ctx) => {
    refuseAgents(ctx.actor, "pause agents");
    const rows = await ctx.tx
      .update(agents)
      .set({ status: input.paused ? "paused" : "active" })
      .returning({ id: agents.id });
    ctx.setSubject("agent", "all");
    ctx.queueEvent(input.paused ? "agent.allPaused" : "agent.allResumed", {
      count: rows.length,
    });
    return { changed: rows.length };
  },
});

/* ------------------------------------------------------------------ tasks */

const taskInput = {
  title: z.string().min(1).max(200),
  brief: z.string().max(50_000).default(""),
  input: z.record(z.string(), z.unknown()).default({}),
  inputTrust: z.enum(["owner", "system", "untrusted"]).default("owner"),
  agentId: z.uuid().nullish(),
  parentId: z.uuid().nullish(),
  priority: z.number().int().min(1).max(5).default(3),
  dependsOn: z.array(z.uuid()).max(50).default([]),
  dueAt: z.iso.datetime().nullish(),
  autonomyCeiling: z.enum(AUTONOMY).nullish(),
  budgetCents: z.number().int().min(0).max(10_000_000).nullish(),
};

/**
 * Ask for work to be done.
 *
 * Open to agents, unlike everything else here, because decomposition *is* an
 * agent creating tasks. The two constraints it cannot escape are applied
 * below: a child inherits its parent's trust, and cannot be more autonomous
 * than its parent.
 */
export const createTask = defineService({
  name: "agents.createTask",
  summary: "Create a task for an agent to do.",
  kind: "mutation",
  permission: "scoped",
  input: z.object(taskInput),
  output: taskRow,
  handler: async (input, ctx) => {
    let rootId: string | undefined;
    let inputTrust = input.inputTrust;
    let ceiling = input.autonomyCeiling ?? null;

    if (input.parentId) {
      const [parent] = await ctx.tx
        .select({
          id: agentTasks.id,
          rootId: agentTasks.rootId,
          inputTrust: agentTasks.inputTrust,
          autonomyCeiling: agentTasks.autonomyCeiling,
        })
        .from(agentTasks)
        .where(eq(agentTasks.id, input.parentId))
        .limit(1);
      if (!parent) throw new ServiceError("not_found", "No such parent task.");

      rootId = parent.rootId;

      // Trust flows down and never up. An agent handed a customer's message
      // cannot launder it by writing a child task and calling the input its
      // own — which is exactly what a prompt injection would try.
      if (parent.inputTrust === "untrusted") inputTrust = "untrusted";

      // Nor can a child be more autonomous than the task that spawned it.
      const parentCeiling = parent.autonomyCeiling;
      if (parentCeiling) {
        ceiling =
          ceiling && RANK[ceiling] < RANK[parentCeiling] ? ceiling : parentCeiling;
      }
    }

    const [row] = await ctx.tx
      .insert(agentTasks)
      .values({
        parentId: input.parentId ?? null,
        // A top-level task is its own root, filled in below once the id exists.
        rootId: rootId ?? "00000000-0000-0000-0000-000000000000",
        agentId: input.agentId ?? null,
        title: input.title,
        brief: input.brief,
        input: input.input,
        inputTrust,
        priority: input.priority,
        dependsOn: input.dependsOn,
        dueAt: input.dueAt ? new Date(input.dueAt) : null,
        autonomyCeiling: ceiling,
        budgetCents: input.budgetCents ?? null,
        createdByActor: actorString(ctx.actor),
        source: ctx.actor.kind === "agent" ? "agent" : "human",
      })
      .returning();

    if (!rootId) {
      // Its own root. Done as a second write rather than with a pre-generated
      // id so the database keeps issuing them.
      await ctx.tx
        .update(agentTasks)
        .set({ rootId: row!.id })
        .where(eq(agentTasks.id, row!.id));
      row!.rootId = row!.id;
    }

    ctx.setSubject("agent_task", row!.id);
    ctx.queueEvent("agentTask.created", {
      id: row!.id,
      title: row!.title,
      agentId: row!.agentId,
    });
    return row!;
  },
});

export const BOARD_COLUMNS = [
  "queued",
  "running",
  "waiting_approval",
  "needs_attention",
  "done",
] as const;

export type BoardColumn = (typeof BOARD_COLUMNS)[number];

export function boardColumn(
  status: (typeof taskStatus.options)[number],
): BoardColumn | null {
  if (status === "cancelled") return null;
  if (status === "failed" || status === "blocked") return "needs_attention";
  return status;
}

export const listTasks = defineService({
  name: "agents.tasks",
  summary: "The board of work.",
  kind: "query",
  permission: "scoped",
  input: z.object({
    status: z
      .array(
        z.enum([
          "queued",
          "running",
          "waiting_approval",
          "blocked",
          "done",
          "failed",
          "needs_attention",
          "cancelled",
        ]),
      )
      .optional(),
    agentId: z.uuid().optional(),
    unassigned: z.boolean().optional(),
    rootId: z.uuid().optional(),
    dueBefore: z.iso.datetime().optional(),
    dueAfter: z.iso.datetime().optional(),
    minPriority: z.number().int().min(1).max(5).optional(),
    includeCancelled: z.boolean().default(false),
    limit: z.number().int().min(1).max(200).default(50),
  }),
  output: listed(taskRow),
  handler: async (input, ctx) => {
    const filters = [
      input.status ? inArray(agentTasks.status, input.status) : undefined,
      !input.status && !input.includeCancelled
        ? sql`${agentTasks.status} <> 'cancelled'`
        : undefined,
      input.agentId ? eq(agentTasks.agentId, input.agentId) : undefined,
      input.unassigned ? isNull(agentTasks.agentId) : undefined,
      input.rootId ? eq(agentTasks.rootId, input.rootId) : undefined,
      input.dueBefore ? lte(agentTasks.dueAt, new Date(input.dueBefore)) : undefined,
      input.dueAfter ? gte(agentTasks.dueAt, new Date(input.dueAfter)) : undefined,
      input.minPriority ? gte(agentTasks.priority, input.minPriority) : undefined,
    ].filter((clause) => clause !== undefined);

    return ctx.tx
      .select()
      .from(agentTasks)
      .where(filters.length > 0 ? and(...filters) : undefined)
      .orderBy(desc(agentTasks.priority), asc(agentTasks.createdAt))
      .limit(input.limit);
  },
});

export const listBoard = defineService({
  name: "agents.board",
  summary: "The work board grouped the way an owner scans it.",
  kind: "query",
  permission: "scoped",
  input: z.object({
    agentId: z.uuid().optional(),
    unassigned: z.boolean().optional(),
    dueBefore: z.iso.datetime().optional(),
    minPriority: z.number().int().min(1).max(5).optional(),
  }),
  output: listed(
    row({
      column: z.enum(BOARD_COLUMNS),
      tasks: listed(taskRow),
    }),
  ),
  handler: async (input, ctx) => {
    const tasks = await ctx.call(listTasks, {
      agentId: input.agentId,
      unassigned: input.unassigned,
      dueBefore: input.dueBefore,
      minPriority: input.minPriority,
      includeCancelled: false,
      limit: 200,
    });
    return BOARD_COLUMNS.map((column) => ({
      column,
      tasks: tasks.filter((task) => boardColumn(task.status) === column),
    }));
  },
});

/** One task, with the runs and steps that explain what happened to it. */
export const getTask = defineService({
  name: "agents.task",
  summary: "One task, with its runs and what each did.",
  kind: "query",
  permission: "scoped",
  input: z.object({ id: z.uuid() }),
  output: taskRow
    .extend({
      runs: listed(runRow),
      steps: listed(stepRow),
      children: listed(taskRow),
    })
    .nullable(),
  handler: async (input, ctx) => {
    const [task] = await ctx.tx
      .select()
      .from(agentTasks)
      .where(eq(agentTasks.id, input.id))
      .limit(1);
    if (!task) return null;

    const runs = await ctx.tx
      .select()
      .from(agentRuns)
      .where(eq(agentRuns.taskId, task.id))
      .orderBy(asc(agentRuns.attempt));

    const steps = runs.length
      ? await ctx.tx
          .select()
          .from(agentSteps)
          .where(
            inArray(
              agentSteps.runId,
              runs.map((run) => run.id),
            ),
          )
          .orderBy(asc(agentSteps.seq))
      : [];

    const children = await ctx.tx
      .select()
      .from(agentTasks)
      .where(eq(agentTasks.parentId, task.id))
      .orderBy(asc(agentTasks.createdAt));

    return { ...task, runs, steps: steps.map(redactStep), children };
  },
});

export const inspectRun = defineService({
  name: "agents.inspectRun",
  summary: "One run and its redacted steps.",
  kind: "query",
  permission: "scoped",
  input: z.object({ runId: z.uuid() }),
  output: runRow
    .extend({
      steps: listed(stepRow),
    })
    .nullable(),
  handler: async (input, ctx) => {
    const [run] = await ctx.tx
      .select()
      .from(agentRuns)
      .where(eq(agentRuns.id, input.runId))
      .limit(1);
    if (!run) return null;
    const steps = await ctx.tx
      .select()
      .from(agentSteps)
      .where(eq(agentSteps.runId, run.id))
      .orderBy(asc(agentSteps.seq));
    return { ...run, steps: steps.map(redactStep) };
  },
});

export const tailRun = defineService({
  name: "agents.tailRun",
  summary: "New redacted steps since a sequence number, for a live run view.",
  kind: "query",
  permission: "scoped",
  input: z.object({
    runId: z.uuid(),
    afterSeq: z.number().int().min(0).default(0),
  }),
  output: runRow
    .extend({
      live: z.boolean(),
      steps: listed(stepRow),
    })
    .nullable(),
  handler: async (input, ctx) => {
    const [run] = await ctx.tx
      .select()
      .from(agentRuns)
      .where(eq(agentRuns.id, input.runId))
      .limit(1);
    if (!run) return null;
    const steps = await ctx.tx
      .select()
      .from(agentSteps)
      .where(
        and(eq(agentSteps.runId, run.id), sql`${agentSteps.seq} > ${input.afterSeq}`),
      )
      .orderBy(asc(agentSteps.seq));
    return {
      ...run,
      live: run.status === "running",
      steps: steps.map(redactStep),
    };
  },
});

export const stopRun = defineService({
  name: "agents.stopRun",
  summary: "End an active run and revoke its lease.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    runId: z.uuid(),
    reason: z.string().max(500).optional(),
  }),
  output: runRow.extend({ taskStatus: z.enum(["queued", "needs_attention"]) }),
  handler: async (input, ctx) => {
    refuseAgents(ctx.actor, "stop a run");
    const [run] = await ctx.tx
      .select()
      .from(agentRuns)
      .where(eq(agentRuns.id, input.runId))
      .limit(1);
    if (!run) throw new ServiceError("not_found", "No such run.");
    if (run.status !== "running") {
      throw new ServiceError("conflict", "That run is not active.");
    }
    const reason = input.reason ?? "Stopped by the owner.";
    const [ended] = await ctx.tx
      .update(agentRuns)
      .set({
        status: "cancelled",
        stopReason: "cancelled",
        endedAt: sql`now()`,
        leaseExpiresAt: null,
        error: reason,
      })
      .where(eq(agentRuns.id, run.id))
      .returning();
    const [task] = await ctx.tx
      .select({ attempts: agentTasks.attempts })
      .from(agentTasks)
      .where(eq(agentTasks.id, run.taskId))
      .limit(1);
    const taskStatus =
      (task?.attempts ?? 0) >= MAX_TASK_ATTEMPTS
        ? ("needs_attention" as const)
        : ("queued" as const);
    await ctx.tx
      .update(agentTasks)
      .set({ status: taskStatus, failureReason: reason })
      .where(eq(agentTasks.id, run.taskId));
    ctx.setSubject("agent_task", run.taskId);
    ctx.queueEvent("agentRun.stopped", { runId: run.id, taskId: run.taskId });
    return { ...ended!, taskStatus };
  },
});

export const retryTask = defineService({
  name: "agents.retryTask",
  summary: "Put failed or parked work back on the queue for another attempt.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({ id: z.uuid() }),
  output: taskRow,
  handler: async (input, ctx) => {
    refuseAgents(ctx.actor, "retry work");
    const [before] = await ctx.tx
      .select()
      .from(agentTasks)
      .where(eq(agentTasks.id, input.id))
      .limit(1);
    if (!before) throw new ServiceError("not_found", "No such task.");
    if (before.status === "running") {
      throw new ServiceError("conflict", "Stop the run before retrying this task.");
    }
    if (before.status === "done") {
      throw new ServiceError("conflict", "Finished work cannot be retried.");
    }
    const [live] = await ctx.tx
      .select({ id: agentRuns.id })
      .from(agentRuns)
      .where(and(eq(agentRuns.taskId, before.id), eq(agentRuns.status, "running")))
      .limit(1);
    if (live) {
      throw new ServiceError("conflict", "Stop the run before retrying this task.");
    }
    const [row] = await ctx.tx
      .update(agentTasks)
      .set({ status: "queued", failureReason: null, attempts: 0 })
      .where(eq(agentTasks.id, input.id))
      .returning();
    ctx.setSubject("agent_task", row!.id);
    ctx.queueEvent("agentTask.retried", { id: row!.id });
    return row!;
  },
});

export const updateTask = defineService({
  name: "agents.updateTask",
  summary: "Change a task's priority, due date or brief.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    id: z.uuid(),
    title: z.string().min(1).max(200).optional(),
    brief: z.string().max(50_000).optional(),
    priority: z.number().int().min(1).max(5).optional(),
    dueAt: z.iso.datetime().nullable().optional(),
  }),
  output: taskRow,
  handler: async (input, ctx) => {
    refuseAgents(ctx.actor, "edit the board");
    const patch: {
      title?: string;
      brief?: string;
      priority?: number;
      dueAt?: Date | null;
    } = {};
    if (input.title !== undefined) patch.title = input.title;
    if (input.brief !== undefined) patch.brief = input.brief;
    if (input.priority !== undefined) patch.priority = input.priority;
    if (input.dueAt !== undefined) patch.dueAt = input.dueAt ? new Date(input.dueAt) : null;
    if (Object.keys(patch).length === 0) {
      throw new ServiceError("validation", "agents.updateTask: nothing to change");
    }
    const [row] = await ctx.tx
      .update(agentTasks)
      .set(patch)
      .where(eq(agentTasks.id, input.id))
      .returning();
    if (!row) throw new ServiceError("not_found", "No such task.");
    ctx.setSubject("agent_task", row.id);
    ctx.queueEvent("agentTask.updated", { id: row.id });
    return row;
  },
});

export const flagTask = defineService({
  name: "agents.flagTask",
  summary: "Park a task on the needs-attention column.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    id: z.uuid(),
    reason: z.string().min(1).max(500),
  }),
  output: taskRow,
  handler: async (input, ctx) => {
    refuseAgents(ctx.actor, "flag work as needing attention");
    const [before] = await ctx.tx
      .select({ status: agentTasks.status })
      .from(agentTasks)
      .where(eq(agentTasks.id, input.id))
      .limit(1);
    if (!before) throw new ServiceError("not_found", "No such task.");
    if (before.status === "done" || before.status === "cancelled") {
      throw new ServiceError("conflict", "Finished work cannot be flagged.");
    }
    const [row] = await ctx.tx
      .update(agentTasks)
      .set({ status: "needs_attention", failureReason: input.reason })
      .where(eq(agentTasks.id, input.id))
      .returning();
    ctx.setSubject("agent_task", row!.id);
    ctx.queueEvent("agentTask.flagged", { id: row!.id });
    return row!;
  },
});

export const reopenTask = defineService({
  name: "agents.reopenTask",
  summary: "Send needs-attention work back to the queue, or park it as blocked.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({ id: z.uuid() }),
  output: taskRow,
  handler: async (input, ctx) => {
    refuseAgents(ctx.actor, "reopen work");
    const [before] = await ctx.tx
      .select()
      .from(agentTasks)
      .where(eq(agentTasks.id, input.id))
      .limit(1);
    if (!before) throw new ServiceError("not_found", "No such task.");
    if (!["needs_attention", "failed", "blocked", "cancelled"].includes(before.status)) {
      throw new ServiceError("conflict", "Only parked or failed work can be reopened.");
    }
    let next: "queued" | "blocked" = "queued";
    if (before.dependsOn.length > 0) {
      const blockers = await ctx.tx
        .select({ id: agentTasks.id, status: agentTasks.status })
        .from(agentTasks)
        .where(inArray(agentTasks.id, before.dependsOn));
      if (blockers.some((row) => row.status !== "done")) next = "blocked";
    }
    const [row] = await ctx.tx
      .update(agentTasks)
      .set({ status: next, failureReason: null })
      .where(eq(agentTasks.id, input.id))
      .returning();
    ctx.setSubject("agent_task", row!.id);
    ctx.queueEvent("agentTask.reopened", { id: row!.id, status: row!.status });
    return row!;
  },
});

export const assignTask = defineService({
  name: "agents.assignTask",
  summary: "Give a task to a particular worker.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({ id: z.uuid(), agentId: z.uuid().nullable() }),
  output: taskRow,
  handler: async (input, ctx) => {
    refuseAgents(ctx.actor, "reassign work");
    const [row] = await ctx.tx
      .update(agentTasks)
      .set({ agentId: input.agentId })
      .where(eq(agentTasks.id, input.id))
      .returning();
    if (!row) throw new ServiceError("not_found", "No such task.");
    ctx.setSubject("agent_task", input.id);
    ctx.queueEvent("agentTask.assigned", { id: input.id, agentId: input.agentId });
    return row;
  },
});

export const cancelTask = defineService({
  name: "agents.cancelTask",
  summary: "Stop a task, and everything it spawned.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({ id: z.uuid(), reason: z.string().max(500).optional() }),
  output: z.object({ cancelled: z.number().int() }),
  handler: async (input, ctx) => {
    const [task] = await ctx.tx
      .select({ id: agentTasks.id, rootId: agentTasks.rootId })
      .from(agentTasks)
      .where(eq(agentTasks.id, input.id))
      .limit(1);
    if (!task) throw new ServiceError("not_found", "No such task.");

    // Cancelling one task while its children carry on would leave an owner
    // watching work they thought they had stopped. The subtree goes together.
    const cancelled = await ctx.tx
      .update(agentTasks)
      .set({
        status: "cancelled",
        failureReason: input.reason ?? "Cancelled.",
      })
      .where(
        and(
          sql`${agentTasks.id} = ${input.id} or ${agentTasks.parentId} = ${input.id}`,
          inArray(agentTasks.status, ["queued", "running", "blocked", "waiting_approval"]),
        ),
      )
      .returning({ id: agentTasks.id });

    await revokeRuns(
      ctx.tx,
      cancelled.map((row) => row.id),
      input.reason ?? "Cancelled.",
    );

    ctx.setSubject("agent_task", input.id);
    ctx.queueEvent("agentTask.cancelled", { id: input.id, count: cancelled.length });
    return { cancelled: cancelled.length };
  },
});

/* ------------------------------------------------------------------ money */

/** What an agent has spent this period, and what it is allowed to. */
export const agentSpendReport = defineService({
  name: "agents.spend",
  summary: "What each worker has cost this period.",
  kind: "query",
  permission: "scoped",
  input: z.object({}),
  output: listed(
    row({
      id: uuid,
      name: z.string(),
      budgetCents: z.number().int(),
      budgetPeriod: z.enum(["day", "week", "month"]),
      spentCents: z.number().int(),
    }),
  ),
  handler: async (_input, ctx) => {
    const rows = await ctx.tx
      .select({
        id: agents.id,
        name: agents.name,
        budgetCents: agents.budgetCents,
        budgetPeriod: agents.budgetPeriod,
        spentCents: sql<number>`coalesce(sum(${agentSpend.costCents}), 0)::int`,
      })
      .from(agents)
      .leftJoin(
        agentSpend,
        and(
          eq(agentSpend.agentId, agents.id),
          // The current window only: a budget is per period, so a total across
          // all time would be a different and much less useful number.
          sql`${agentSpend.periodStart} >= date_trunc(${agents.budgetPeriod}, now())`,
        ),
      )
      .groupBy(agents.id, agents.name, agents.budgetCents, agents.budgetPeriod)
      .orderBy(asc(agents.name));
    return rows;
  },
});

export default [
  listConnections,
  connectAgentRuntime,
  listAgents,
  hireAgent,
  updateAgent,
  pauseAllAgents,
  createTask,
  listTasks,
  listBoard,
  getTask,
  inspectRun,
  tailRun,
  stopRun,
  retryTask,
  updateTask,
  flagTask,
  reopenTask,
  assignTask,
  cancelTask,
  agentSpendReport,
];
