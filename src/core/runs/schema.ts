// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Runs, steps, approvals and spend, for whatever does work (MASTER.md §4.17, §40).
//
// These four arrived with the agent layer (§40, C4.02–C4.04) and moved here
// when automations became the second thing that runs (§4.17, C9.02). §4.17's
// reason is the one that matters: an automation mixing a prompt step with a
// deterministic one must produce **one** inspectable run. Two runtimes would
// give two run histories for one piece of work, two inspection surfaces in the
// admin, and no single place to put an approval in front of the whole thing.
//
// **This is not the same shape the agent tables had, and could not be.**
// `agent_runs.task_id` and `agent_id` were both NOT NULL: a run was, by
// construction, an agent working a task. An automation run has neither — a
// deterministic `call` step involves no agent at all. So the owner became
// polymorphic and the worker became optional, which is what a run actually is:
// something that happened, caused by one thing, possibly performed by another.
//
// Neither the owner nor the worker carries a foreign key, the same shape
// `ContentUnlock` (§4.3) and `Document` (§4.5) use. That is deliberate rather
// than lazy: a generic runtime with a foreign key to `agent_tasks` is not
// generic, it is the agent runtime with extra steps — and core would then own
// a table that cannot exist without a module-shaped concept. The trade is that
// a deleted owner leaves a dangling id, which the owning side cleans up,
// against a runtime that genuinely belongs to nobody.
import { sql } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "@/core/auth/schema";
import { createdAtColumn, updatedAtColumn } from "@/core/db/columns";

/** What caused a run. Extended when a third thing starts running work. */
export const RUN_SUBJECTS = ["agent_task", "automation"] as const;
export const RUN_STATUSES = ["running", "done", "failed", "cancelled"] as const;
export const STEP_KINDS = [
  "message",
  "tool_call",
  "tool_result",
  "note",
  // C9.02 adds the automation kinds — `call`, `prompt`, `wait`, `branch` and
  // the rest — with the runtime that writes them. This change moves the tables
  // and nothing else, so the enum is still exactly what agents record.
] as const;

export const runs = pgTable(
  "runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Which kind of thing this run belongs to. */
    subjectKind: text("subject_kind", { enum: RUN_SUBJECTS }).notNull(),
    /** The agent task, or the automation. No FK — see the file header. */
    subjectId: uuid("subject_id").notNull(),
    /**
     * Who did the work, when anybody did.
     *
     * Nullable, which is the whole difference from `agent_runs`: an automation
     * whose steps are all module verbs is worked by nothing, and a NOT NULL
     * column here would have forced a fake agent into existence to satisfy it.
     */
    agentId: uuid("agent_id"),
    attempt: integer("attempt").notNull().default(1),
    status: text("status", { enum: RUN_STATUSES }).notNull().default("running"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
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
     * and the work becomes claimable again — which is the only way to tell
     * "still working" from "gone" across a network.
     */
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    index("runs_subject_idx").on(t.subjectKind, t.subjectId),
    index("runs_agent_idx").on(t.agentId),
    index("runs_lease_idx").on(t.leaseExpiresAt).where(sql`${t.status} = 'running'`),
  ],
);

/**
 * What happened inside a run, in order.
 *
 * This is not a second copy of the audit trail. The audit row says what a
 * mutation changed; a step says that this run called that service at this
 * point, and what it cost. Together they answer "why did this happen", which
 * neither answers alone.
 */
export const runSteps = pgTable(
  "run_steps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    kind: text("kind", { enum: STEP_KINDS }).notNull(),
    serviceName: text("service_name"),
    /** Redacted by the same rule the audit trail uses — secrets never land here. */
    input: jsonb("input"),
    output: jsonb("output"),
    tokens: integer("tokens").notNull().default(0),
    durationMs: integer("duration_ms"),
    error: text("error"),
    createdAt: createdAtColumn(),
  },
  (t) => [uniqueIndex("run_steps_run_seq_idx").on(t.runId, t.seq)],
);

/**
 * A side-effect waiting on a person (§40's `approve` rung, §4.17's `gate`).
 *
 * `preview` is the field that decides whether this feature is usable: an owner
 * approving "send email" is rubber-stamping, and an owner approving *the
 * actual email* is deciding. The shape is per-kind and rendered by the admin.
 *
 * `runId` is nullable and `subjectId` is not, because a proposal can exist
 * before any run does — §40's `suggest` rung produces exactly that.
 */
export const runApprovals = pgTable(
  "run_approvals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id").references(() => runs.id, { onDelete: "cascade" }),
    subjectKind: text("subject_kind", { enum: RUN_SUBJECTS }).notNull(),
    subjectId: uuid("subject_id").notNull(),
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
     * The effective autonomy when the row was created. The inbox must be able
     * to tell a suggest-rung proposal from an approval request without
     * guessing from surrounding state.
     */
    proposedAutonomy: text("proposed_autonomy", {
      enum: ["suggest", "approve", "autonomous"],
    })
      .notNull()
      .default("approve"),
    status: text("status", { enum: ["pending", "approved", "rejected", "expired"] })
      .notNull()
      .default("pending"),
    decidedBy: uuid("decided_by").references(() => users.id, { onDelete: "set null" }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decisionNote: text("decision_note"),
    /** An approval nobody answers should lapse, not sit pending forever. */
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    index("run_approvals_subject_idx").on(t.subjectKind, t.subjectId),
    index("run_approvals_pending_idx").on(t.createdAt).where(sql`${t.status} = 'pending'`),
  ],
);

/**
 * Money, per agent per period.
 *
 * A ledger rather than a counter on the agent: a counter cannot answer "what
 * did we spend last month", and §40 requires the cap to be enforced *before*
 * each step, which means summing a period rather than trusting a total that
 * something forgot to increment.
 *
 * Still per agent, because only prompt work costs anything — a deterministic
 * automation step spends nothing and would only add zero rows to a ledger
 * whose whole purpose is the sum.
 */
export const runSpend = pgTable(
  "run_spend",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentId: uuid("agent_id").notNull(),
    runId: uuid("run_id").references(() => runs.id, { onDelete: "set null" }),
    /** Start of the budget window this belongs to, in the business's timezone. */
    periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
    costCents: integer("cost_cents").notNull().default(0),
    tokensIn: integer("tokens_in").notNull().default(0),
    tokensOut: integer("tokens_out").notNull().default(0),
    createdAt: createdAtColumn(),
  },
  (t) => [index("run_spend_agent_period_idx").on(t.agentId, t.periodStart)],
);
