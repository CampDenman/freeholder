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
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
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
import {
  actorString,
  defineService,
  ServiceError,
  type Actor,
} from "@/core/service";

const AUTONOMY = ["suggest", "approve", "autonomous"] as const;
type Autonomy = (typeof AUTONOMY)[number];

/** Ordered, so "no higher than" is a comparison rather than a lookup table. */
const RANK: Record<Autonomy, number> = { suggest: 1, approve: 2, autonomous: 3 };

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
    }),
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
    rootId: z.uuid().optional(),
    limit: z.number().int().min(1).max(200).default(50),
  }),
  handler: async (input, ctx) => {
    const filters = [
      input.status ? inArray(agentTasks.status, input.status) : undefined,
      input.agentId ? eq(agentTasks.agentId, input.agentId) : undefined,
      input.rootId ? eq(agentTasks.rootId, input.rootId) : undefined,
    ].filter((clause) => clause !== undefined);

    return ctx.tx
      .select()
      .from(agentTasks)
      .where(filters.length > 0 ? and(...filters) : undefined)
      .orderBy(desc(agentTasks.priority), asc(agentTasks.createdAt))
      .limit(input.limit);
  },
});

/** One task, with the runs and steps that explain what happened to it. */
export const getTask = defineService({
  name: "agents.task",
  summary: "One task, with its runs and what each did.",
  kind: "query",
  permission: "scoped",
  input: z.object({ id: z.uuid() }),
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

    return { ...task, runs, steps, children };
  },
});

export const assignTask = defineService({
  name: "agents.assignTask",
  summary: "Give a task to a particular worker.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({ id: z.uuid(), agentId: z.uuid().nullable() }),
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
  getTask,
  assignTask,
  cancelTask,
  agentSpendReport,
];
