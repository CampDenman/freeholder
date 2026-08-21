// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The agent orchestration layer (MASTER.md §40).
//
// §40's premise is that agent work is long-running, partly autonomous and
// occasionally wrong, so every part of it is a row rather than state in a
// process. A run that was interrupted by a deploy is a row that says so; a
// task nobody finished is a row an owner can find; an action an agent wanted
// to take but was not allowed to is a row waiting for a person.
//
// The tables lean on two things that already exist rather than restating them.
// An agent's authority is an `ApiKey` (§4.8) with scopes, so `actor =
// agent:<name>` is already true at the service layer and agent work is already
// in the audit trail. And a run's *effects* are ordinary service calls, so
// nothing here duplicates what a mutation did — `AgentStep` records that a
// call was made and what it cost, while the audit row records what it changed.
import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { apiKeys } from "@/core/apikeys/schema";
import { users } from "@/core/auth/schema";
import { createdAtColumn, updatedAtColumn } from "@/core/db/columns";

/**
 * How to reach one agent runtime.
 *
 * `kind` is the fork §40 turns on. A *managed* connection means the platform
 * runs the loop itself through an `adapters/agent` adapter. An *inbound*
 * connection means the agent runs wherever the owner already runs it — their
 * own Claude, an IDE agent, a script — and claims work over the HTTP API. The
 * second needs no model provider on this box at all, which is why it ships
 * first.
 */
export const agentConnections = pgTable(
  "agent_connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    kind: text("kind", { enum: ["managed", "inbound"] }).notNull(),
    /** Which `adapters/agent` implementation. Null for inbound: there is none. */
    adapter: text("adapter"),
    model: text("model"),
    /**
     * The *name of an environment variable*, never a key.
     *
     * §17 puts secrets in the environment and configuration in the database,
     * and a provider key is a secret. Storing the name keeps the indirection
     * visible in the admin — an owner can see which variable a connection
     * expects, and doctor can tell them it is missing.
     */
    credentialRef: text("credential_ref"),
    baseUrl: text("base_url"),
    /**
     * What this connection's model costs, in cents per million tokens (C4.06).
     *
     * Configuration, not a secret, so it lives here rather than in the
     * environment (§17). Null falls back to the platform's published-price
     * table; a model absent from both is unpriced, and an unpriced model
     * cannot spend a budget — the fail-closed direction, because a budget
     * enforced against a guessed price is not a budget.
     */
    inputCentsPerMillion: integer("input_cents_per_million"),
    outputCentsPerMillion: integer("output_cents_per_million"),
    /** How many runs this runtime will take at once. */
    maxConcurrency: integer("max_concurrency").notNull().default(2),
    status: text("status", { enum: ["active", "paused"] })
      .notNull()
      .default("active"),
    /** Inbound runtimes prove they are alive by claiming; managed ones by running. */
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdBy: uuid("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [uniqueIndex("agent_connections_name_idx").on(t.name)],
);

/**
 * A named worker.
 *
 * Several agents may share one connection: "Inbox triager" and "SEO writer"
 * can be the same model with different briefs, scopes and budgets, and they
 * should appear in an owner's audit trail as two different workers because
 * that is what they are.
 */
export const agents = pgTable(
  "agents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => agentConnections.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    /** One line: "triages the inbox and drafts replies". */
    role: text("role").notNull(),
    /** The durable brief — what this worker always needs to know. */
    instructions: text("instructions").notNull().default(""),
    /**
     * Its own credential (§40's envelope). Restricted rather than cascaded on
     * delete: revoking a key must not silently delete the worker whose history
     * explains what that key did.
     */
    apiKeyId: uuid("api_key_id").references(() => apiKeys.id, {
      onDelete: "set null",
    }),
    /** Mirrors the key's scopes, so the admin can show them without a join. */
    toolScopes: text("tool_scopes").array().notNull().default(sql`'{}'`),
    /** The ceiling. A task may lower it and may never raise it (§40). */
    autonomy: text("autonomy", { enum: ["suggest", "approve", "autonomous"] })
      .notNull()
      .default("suggest"),
    maxConcurrency: integer("max_concurrency").notNull().default(1),
    /** Cap per period, in cents. Zero means no spending is permitted at all. */
    budgetCents: integer("budget_cents").notNull().default(0),
    budgetPeriod: text("budget_period", { enum: ["day", "week", "month"] })
      .notNull()
      .default("month"),
    status: text("status", { enum: ["active", "paused"] })
      .notNull()
      .default("active"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex("agents_name_idx").on(t.name),
    index("agents_connection_idx").on(t.connectionId),
  ],
);

/**
 * One unit of work — a tree, and a graph.
 *
 * `parentId` is decomposition: an agent told to clear an inbox writes a child
 * per message. `dependsOn` is ordering between siblings. `rootId` is
 * denormalised because "everything that came out of this instruction" is the
 * query an owner runs, and a recursive walk is the wrong shape for a screen
 * that has to paginate.
 */
export const agentTasks = pgTable(
  "agent_tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    parentId: uuid("parent_id"),
    /** Itself, for a top-level task. Never null, so the query never branches. */
    rootId: uuid("root_id").notNull(),
    /** Null while nobody has picked it up. */
    agentId: uuid("agent_id").references(() => agents.id, {
      onDelete: "set null",
    }),
    title: text("title").notNull(),
    brief: text("brief").notNull().default(""),
    input: jsonb("input").notNull().default({}),
    /**
     * Where `input` came from, and therefore how it may be treated.
     *
     * §40: untrusted content is quoted data, never instruction, and a task
     * carrying it can never run autonomously whatever its agent's ceiling is.
     * The column exists because this layer's whole purpose is to point agents
     * at customer email and form submissions.
     */
    inputTrust: text("input_trust", { enum: ["owner", "system", "untrusted"] })
      .notNull()
      .default("owner"),
    status: text("status", {
      enum: [
        "queued",
        "running",
        "waiting_approval",
        "blocked",
        "done",
        "failed",
        "needs_attention",
        "cancelled",
      ],
    })
      .notNull()
      .default("queued"),
    /** Higher runs first. Small range on purpose: five levels people can reason about. */
    priority: smallint("priority").notNull().default(3),
    dependsOn: uuid("depends_on").array().notNull().default(sql`'{}'`),
    dueAt: timestamp("due_at", { withTimezone: true }),
    /** Lowers the agent's autonomy for this task only. Never raises it. */
    autonomyCeiling: text("autonomy_ceiling", {
      enum: ["suggest", "approve", "autonomous"],
    }),
    budgetCents: integer("budget_cents"),
    result: jsonb("result"),
    failureReason: text("failure_reason"),
    attempts: integer("attempts").notNull().default(0),
    /** Who or what asked for this: "user:<id>", "agent:<name>", "system". */
    createdByActor: text("created_by_actor").notNull(),
    source: text("source", { enum: ["human", "schedule", "event", "agent"] })
      .notNull()
      .default("human"),
    /** The event name, playbook id or parent run that produced it. */
    sourceRef: text("source_ref"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    index("agent_tasks_root_idx").on(t.rootId),
    index("agent_tasks_parent_idx").on(t.parentId),
    index("agent_tasks_agent_idx").on(t.agentId),
    index("agent_tasks_due_idx").on(t.dueAt),
    index("agent_tasks_status_idx").on(t.status),
    // The claim query: runnable work, best first. Partial, because finished
    // tasks are most of the table and none of them are claimable.
    index("agent_tasks_runnable_idx")
      .on(t.priority, t.createdAt)
      .where(sql`${t.status} = 'queued'`),
  ],
);

/** One attempt at a task by an agent. */
export const agentRuns = pgTable(
  "agent_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => agentTasks.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    attempt: integer("attempt").notNull().default(1),
    status: text("status", { enum: ["running", "done", "failed", "cancelled"] })
      .notNull()
      .default("running"),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    model: text("model"),
    tokensIn: integer("tokens_in").notNull().default(0),
    tokensOut: integer("tokens_out").notNull().default(0),
    costCents: integer("cost_cents").notNull().default(0),
    stopReason: text("stop_reason", {
      enum: ["done", "budget", "timeout", "refused", "error", "cancelled"],
    }),
    error: text("error"),
    /**
     * An inbound runtime holds a lease. If it dies mid-run the lease lapses
     * and the task becomes claimable again — which is the only way to tell
     * "still working" from "gone" across a network.
     */
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    index("agent_runs_task_idx").on(t.taskId),
    index("agent_runs_agent_idx").on(t.agentId),
    index("agent_runs_lease_idx")
      .on(t.leaseExpiresAt)
      .where(sql`${t.status} = 'running'`),
  ],
);

/**
 * What happened inside a run, in order.
 *
 * This is not a second copy of the audit trail. The audit row says what a
 * mutation changed; a step says that this agent called that service at this
 * point in its reasoning, and what it cost. Together they answer "why did this
 * happen", which neither answers alone.
 */
export const agentSteps = pgTable(
  "agent_steps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => agentRuns.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    kind: text("kind", {
      enum: ["message", "tool_call", "tool_result", "note"],
    }).notNull(),
    serviceName: text("service_name"),
    /** Redacted by the same rule the audit trail uses — secrets never land here. */
    input: jsonb("input"),
    output: jsonb("output"),
    tokens: integer("tokens").notNull().default(0),
    durationMs: integer("duration_ms"),
    error: text("error"),
    createdAt: createdAtColumn(),
  },
  (t) => [uniqueIndex("agent_steps_run_seq_idx").on(t.runId, t.seq)],
);

/**
 * A side-effect waiting on a person (§40's `approve` rung).
 *
 * `preview` is the field that decides whether this feature is usable: an
 * owner approving "send email" is rubber-stamping, and an owner approving *the
 * actual email* is deciding. The shape is per-kind and rendered by the admin.
 */
export const agentApprovals = pgTable(
  "agent_approvals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id").references(() => agentRuns.id, { onDelete: "cascade" }),
    taskId: uuid("task_id")
      .notNull()
      .references(() => agentTasks.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    summary: text("summary").notNull(),
    preview: jsonb("preview").notNull().default({}),
    /**
     * The call that will be made, verbatim, if this is approved. Never
     * redacted at rest — C4.04 replays exactly this — so every read surface
     * redacts before showing it.
     */
    serviceName: text("service_name").notNull(),
    input: jsonb("input").notNull().default({}),
    /**
     * The effective autonomy when the row was created. The inbox must be
     * able to tell a suggest-rung proposal from an approval request without
     * guessing from surrounding state.
     */
    proposedAutonomy: text("proposed_autonomy", {
      enum: ["suggest", "approve", "autonomous"],
    })
      .notNull()
      .default("approve"),
    status: text("status", {
      enum: ["pending", "approved", "rejected", "expired"],
    })
      .notNull()
      .default("pending"),
    decidedBy: uuid("decided_by").references(() => users.id, {
      onDelete: "set null",
    }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decisionNote: text("decision_note"),
    /** An approval nobody answers should lapse, not sit pending forever. */
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    index("agent_approvals_task_idx").on(t.taskId),
    index("agent_approvals_pending_idx")
      .on(t.createdAt)
      .where(sql`${t.status} = 'pending'`),
  ],
);

/**
 * Money, per agent per period.
 *
 * A ledger rather than a counter on the agent: a counter cannot answer "what
 * did we spend last month", and §40 requires the cap to be enforced *before*
 * each step, which means summing a period rather than trusting a total that
 * something forgot to increment.
 */
export const agentSpend = pgTable(
  "agent_spend",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    runId: uuid("run_id").references(() => agentRuns.id, { onDelete: "set null" }),
    /** Start of the budget window this belongs to, in the business's timezone. */
    periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
    costCents: integer("cost_cents").notNull().default(0),
    tokensIn: integer("tokens_in").notNull().default(0),
    tokensOut: integer("tokens_out").notNull().default(0),
    createdAt: createdAtColumn(),
  },
  (t) => [index("agent_spend_agent_period_idx").on(t.agentId, t.periodStart)],
);

/** Reusable work with a trigger (§40, stage 5). */
export const agentPlaybooks = pgTable(
  "agent_playbooks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    briefTemplate: text("brief_template").notNull(),
    defaultAgentId: uuid("default_agent_id").references(() => agents.id, {
      onDelete: "set null",
    }),
    paramsSchema: jsonb("params_schema").notNull().default({}),
    trigger: text("trigger", { enum: ["manual", "schedule", "event"] })
      .notNull()
      .default("manual"),
    scheduleCron: text("schedule_cron"),
    /**
     * The zone the cron is read in (§4.9). Null means the business's own, so
     * "every morning at 7" stays 7 in the morning across a clock change
     * instead of drifting to 6 or 8 for half the year.
     */
    timezone: text("timezone"),
    /**
     * The whole schedule as one indexed timestamp (C4.14). Due is a range
     * scan, not a cron parse per row per minute, and advancing it is how an
     * outage stays an outage rather than becoming a stampede.
     */
    nextRunAt: timestamp("next_run_at", { withTimezone: true }),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    /** Whether a window missed while the instance was down runs late. */
    catchUp: boolean("catch_up").notNull().default(false),
    /** What happened last time, in the words the owner is shown. */
    lastOutcome: text("last_outcome"),
    eventPattern: text("event_pattern"),
    enabled: boolean("enabled").notNull().default(true),
    /**
     * The current prompt version (C4.08). Every change to the brief or the
     * parameters writes a row in `agent_playbook_versions` and bumps this, so
     * a task can record which wording produced it — "the playbook was
     * different then" is otherwise unanswerable.
     */
    version: integer("version").notNull().default(1),
    /**
     * A ceiling on what work from this playbook may do, independent of the
     * agent's own. §40's ladder only lowers, so a playbook can be more
     * cautious than its worker and never more permissive.
     */
    autonomyCeiling: text("autonomy_ceiling", {
      enum: ["suggest", "approve", "autonomous"],
    }),
    /** Optional per-task money ceiling for work this playbook creates. */
    budgetCents: integer("budget_cents"),
    /**
     * "Report into my briefing" (§42, C4.17).
     *
     * This is the mechanism behind adding more and more things an owner wants
     * their agents to do regularly and report on: they write a prompt, pick a
     * schedule, and tick this. What the work produced then appears as its own
     * briefing section, which they can hide like any other without stopping
     * the work itself.
     */
    reportsToBriefing: boolean("reports_to_briefing").notNull().default(false),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [uniqueIndex("agent_playbooks_name_idx").on(t.name)],
);

/**
 * Every wording a playbook has had (C4.08).
 *
 * Prompts are how an owner directs work, and they get edited. Without the
 * history, a task that went wrong last month cannot be read against the
 * instructions it was actually given — the row says what the playbook says
 * *now*, which is a different sentence.
 */
export const agentPlaybookVersions = pgTable(
  "agent_playbook_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    playbookId: uuid("playbook_id")
      .notNull()
      .references(() => agentPlaybooks.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    briefTemplate: text("brief_template").notNull(),
    paramsSchema: jsonb("params_schema").notNull().default({}),
    /** Why this wording changed, in the editor's own words. */
    note: text("note"),
    createdBy: uuid("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: createdAtColumn(),
  },
  (t) => [
    uniqueIndex("agent_playbook_versions_idx").on(t.playbookId, t.version),
  ],
);
