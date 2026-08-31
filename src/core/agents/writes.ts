// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Managed writes honour the autonomy ladder (C4.03, MASTER.md §40).
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { listed, row, timestamp, uuid } from "@/core/contract";
import {
  defineService,
  getService,
  permits,
  redact,
  ServiceError,
  type ServiceContext,
} from "@/core/service";
import { agentTasks } from "@/core/agents/schema";
import { runApprovals, runs } from "@/core/runs/schema";
import { effectiveAutonomy } from "@/core/agents/service";
import { agentForActor } from "@/core/agents/execution";
import {
  alwaysRequiresApproval,
  buildWritePreview,
  classifyManagedWrite,
  previewSummary,
  WRITE_KINDS,
} from "@/core/agents/previews";

const approvalRow = row({
  id: uuid,
  runId: uuid.nullable(),
  taskId: uuid,
  kind: z.enum(WRITE_KINDS),
  summary: z.string(),
  preview: z.unknown(),
  serviceName: z.string(),
  input: z.unknown(),
  proposedAutonomy: z.enum(["suggest", "approve", "autonomous"]),
  status: z.enum(["pending", "approved", "rejected", "expired"]),
  decidedBy: uuid.nullable(),
  decidedAt: timestamp.nullable(),
  decisionNote: z.string().nullable(),
  expiresAt: timestamp.nullable(),
  createdAt: timestamp,
});

/** What proposeWrite hands back: secrets stay out of agent-visible copies. */
/**
 * An approval as this layer names it, with its input redacted.
 *
 * `core/runs` calls the owner `subjectId` because a run can belong to an
 * automation as easily as to a task (§4.17). In the agent layer it is always a
 * task, so the contract keeps saying `taskId` — the projection lives here
 * rather than leaking core's polymorphism into an API that has no use for it.
 */
function redactedApproval<T extends { input: unknown; subjectId: string }>(
  approval: T,
): Omit<T, "subjectId"> & { taskId: string; input: unknown } {
  const { subjectId, ...rest } = approval;
  return { ...rest, taskId: subjectId, input: redact(approval.input) ?? {} };
}

async function beforeBlocks(
  ctx: ServiceContext,
  serviceName: string,
  input: unknown,
): Promise<unknown> {
  if (serviceName !== "cms.updatePage" && serviceName !== "cms.updateSection") {
    return null;
  }
  if (!input || typeof input !== "object" || !("id" in input)) return null;
  const id = input.id;
  if (typeof id !== "string") return null;
  try {
    const reader =
      serviceName === "cms.updatePage" ? getService("cms.getPage") : getService("cms.getSection");
    // The agent's own permission, not system: the before half of a diff must
    // never show an agent content its key could not read directly.
    const current = (await ctx.call(reader, { id })) as { blocks?: unknown };
    return current?.blocks ?? null;
  } catch {
    return null;
  }
}

export const proposeWrite = defineService({
  name: "agents.proposeWrite",
  summary: "The managed write gate: execute, propose, or wait for approval.",
  kind: "mutation",
  permission: "public",
  input: z.object({
    runId: z.uuid(),
    serviceName: z.string().min(1).max(120),
    input: z.record(z.string(), z.unknown()).default({}),
    summary: z.string().max(500).optional(),
  }),
  output: row({
    outcome: z.enum(["executed", "proposed", "awaiting_approval"]),
    result: z.unknown().nullable(),
    approval: approvalRow.nullable(),
  }),
  handler: async (input, ctx) => {
    // Resolves through the key join and refuses paused agents and paused
    // connections — the same gate every other agent verb passes through, so
    // the kill switch also stops writes mid-lease.
    const agent = await agentForActor(ctx.tx, ctx.actor);

    const [run] = await ctx.tx
      .select({
        id: runs.id,
        taskId: runs.subjectId,
        agentId: runs.agentId,
        status: runs.status,
      })
      .from(runs)
      .where(eq(runs.id, input.runId))
      .limit(1);
    if (!run || run.status !== "running" || run.agentId !== agent.id) {
      throw new ServiceError("not_found", "No such active run.");
    }

    const [task] = await ctx.tx
      .select({
        id: agentTasks.id,
        inputTrust: agentTasks.inputTrust,
        autonomyCeiling: agentTasks.autonomyCeiling,
      })
      .from(agentTasks)
      .where(eq(agentTasks.id, run.taskId))
      .limit(1);
    if (!task) throw new ServiceError("not_found", "That run has no task.");

    const service = getService(input.serviceName);
    // The gate must not widen the agent's reach: a proposal for a service the
    // key could not call directly is refused before any preview is built, so
    // neither the before-read nor the parked approval leaks or requests
    // authority the agent does not hold.
    if (
      !permits(ctx.actor, service.def.permission, service.def.name, service.def.kind) ||
      service.def.agentCallable === false
    ) {
      throw new ServiceError(
        "permission",
        `This agent's key is not allowed to call ${service.def.name}, so it cannot propose it either.`,
      );
    }

    if (service.def.kind === "query") {
      const result = await ctx.call(service, input.input);
      return { outcome: "executed" as const, result, approval: null };
    }

    const classification = classifyManagedWrite(service.def);
    const kind = classification.kind;
    const preview = buildWritePreview(kind, input.serviceName, input.input, {
      beforeBlocks: await beforeBlocks(ctx, input.serviceName, input.input),
    });
    const summary = input.summary ?? previewSummary(kind, input.serviceName);

    const autonomy = effectiveAutonomy(
      agent.autonomy,
      task.autonomyCeiling,
      task.inputTrust,
    );
    const mustApprove = autonomy !== "autonomous" || alwaysRequiresApproval(classification);

    if (!mustApprove) {
      const result = await ctx.call(service, input.input);
      return { outcome: "executed" as const, result, approval: null };
    }

    // Suggest is the lowest rung: it only ever records a proposal. Approval
    // requests come from the approve rung, or from autonomous work that hit
    // an irreversible or undeclared write.
    const awaiting = autonomy !== "suggest";
    const [inserted] = await ctx.tx
      .insert(runApprovals)
      .values({
        runId: run.id,
        subjectKind: "agent_task",
        subjectId: task.id,
        kind,
        summary,
        preview,
        serviceName: input.serviceName,
        // Verbatim, as the schema promises: C4.04 executes exactly what was
        // approved. Redaction happens on every read surface instead.
        input: input.input,
        proposedAutonomy: autonomy,
        status: "pending",
        expiresAt: sql`now() + interval '7 days'`,
      })
      .returning();

    if (awaiting) {
      await ctx.tx
        .update(agentTasks)
        .set({ status: "waiting_approval" })
        .where(eq(agentTasks.id, task.id));
    }

    ctx.setSubject("agent_approval", inserted!.id);
    ctx.queueEvent("agentApproval.proposed", {
      id: inserted!.id,
      taskId: task.id,
      kind,
    });
    return {
      outcome: awaiting ? ("awaiting_approval" as const) : ("proposed" as const),
      result: null,
      approval: redactedApproval(inserted!),
    };
  },
});

export const listApprovals = defineService({
  name: "agents.listApprovals",
  summary: "Pending and decided managed-write approvals.",
  kind: "query",
  permission: "scoped",
  input: z.object({
    taskId: z.uuid().optional(),
    status: z.enum(["pending", "approved", "rejected", "expired"]).optional(),
    limit: z.number().int().min(1).max(200).default(50),
  }),
  output: listed(approvalRow),
  handler: async (input, ctx) => {
    if (ctx.actor.kind === "agent") {
      throw new ServiceError(
        "permission",
        "An agent cannot review its own approvals. Sign in as the owner.",
      );
    }
    const filters = [
      input.taskId ? eq(runApprovals.subjectId, input.taskId) : undefined,
      input.status ? eq(runApprovals.status, input.status) : undefined,
    ].filter((clause) => clause !== undefined);
    const rows = await ctx.tx
      .select()
      .from(runApprovals)
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(desc(runApprovals.createdAt))
      .limit(input.limit);
    // Stored verbatim for once-only execution; redacted wherever it is shown.
    return rows.map(redactedApproval);
  },
});

/**
 * Load one approval for a decision error message. The atomic claim below is
 * what enforces once-only; this only explains a refused claim truthfully.
 */
async function explainUndecidable(ctx: ServiceContext, id: string): Promise<never> {
  const [existing] = await ctx.tx
    .select({ status: runApprovals.status, expiresAt: runApprovals.expiresAt })
    .from(runApprovals)
    .where(eq(runApprovals.id, id))
    .limit(1);
  if (!existing) throw new ServiceError("not_found", "That approval is not here.");
  if (existing.status === "pending") {
    throw new ServiceError("conflict", "That approval just expired. Ask the agent to propose again.");
  }
  throw new ServiceError(
    "conflict",
    `That approval was already ${existing.status}. Decisions are made exactly once.`,
  );
}

function requireDecider(ctx: ServiceContext): string {
  // agentCallable: false already refuses agents; this pins the rest down.
  // A decision must belong to a person — system composition approving its
  // own agent's work would make the inbox decorative.
  if (ctx.actor.kind !== "user") {
    throw new ServiceError("permission", "Sign in as a person to decide approvals.");
  }
  return ctx.actor.userId;
}

const CLAIMABLE = and(
  eq(runApprovals.status, "pending"),
  sql`(${runApprovals.expiresAt} is null or ${runApprovals.expiresAt} > now())`,
);

/** After a decision or expiry, a task parked on approval goes back to work. */
async function releaseTask(ctx: ServiceContext, taskId: string): Promise<void> {
  const [pending] = await ctx.tx
    .select({ id: runApprovals.id })
    .from(runApprovals)
    .where(and(eq(runApprovals.subjectId, taskId), eq(runApprovals.status, "pending")))
    .limit(1);
  if (pending) return;
  await ctx.tx
    .update(agentTasks)
    .set({ status: "queued" })
    .where(and(eq(agentTasks.id, taskId), eq(agentTasks.status, "waiting_approval")));
}

export const approveWrite = defineService({
  name: "agents.approveWrite",
  summary: "Approve one parked managed write and execute it exactly once.",
  kind: "mutation",
  permission: "scoped",
  stepUp: true,
  agentCallable: false,
  input: z.object({ id: z.uuid(), note: z.string().trim().max(2000).optional() }),
  output: row({ approval: approvalRow, result: z.unknown().nullable() }),
  handler: async (input, ctx) => {
    const decidedBy = requireDecider(ctx);
    // The atomic claim IS the once-only guarantee: two concurrent decisions
    // race on this row lock and the loser matches zero rows. If execution
    // below throws, the whole transaction rolls back and the row stays
    // pending — approved means executed, always.
    const [claimed] = await ctx.tx
      .update(runApprovals)
      .set({
        status: "approved",
        decidedBy,
        decidedAt: sql`now()`,
        decisionNote: input.note?.length ? input.note : null,
      })
      .where(and(eq(runApprovals.id, input.id), CLAIMABLE))
      .returning();
    if (!claimed) await explainUndecidable(ctx, input.id);

    // Exactly what was proposed — the input is stored verbatim for this call
    // and redacted on every read instead. Executed as the approving person,
    // so their own permissions govern the write and the audit trail names
    // who let it happen.
    const service = getService(claimed!.serviceName);
    const result = await ctx.call(service, claimed!.input);

    await releaseTask(ctx, claimed!.subjectId);
    ctx.setSubject("agent_approval", claimed!.id);
    ctx.queueEvent("agentApproval.approved", {
      id: claimed!.id,
      taskId: claimed!.subjectId,
      serviceName: claimed!.serviceName,
    });
    return { approval: redactedApproval(claimed!), result: result ?? null };
  },
});

export const rejectWrite = defineService({
  name: "agents.rejectWrite",
  summary: "Reject one parked managed write, with a note the record keeps.",
  kind: "mutation",
  permission: "scoped",
  stepUp: true,
  agentCallable: false,
  // The note is required: a bare rejection teaches the agent nothing and
  // leaves the audit trail mute about why the owner said no.
  input: z.object({ id: z.uuid(), note: z.string().trim().min(1).max(2000) }),
  output: row({ approval: approvalRow }),
  handler: async (input, ctx) => {
    const decidedBy = requireDecider(ctx);
    const [claimed] = await ctx.tx
      .update(runApprovals)
      .set({
        status: "rejected",
        decidedBy,
        decidedAt: sql`now()`,
        decisionNote: input.note,
      })
      .where(and(eq(runApprovals.id, input.id), CLAIMABLE))
      .returning();
    if (!claimed) await explainUndecidable(ctx, input.id);

    await releaseTask(ctx, claimed!.subjectId);
    ctx.setSubject("agent_approval", claimed!.id);
    ctx.queueEvent("agentApproval.rejected", {
      id: claimed!.id,
      taskId: claimed!.subjectId,
      serviceName: claimed!.serviceName,
    });
    return { approval: redactedApproval(claimed!) };
  },
});

export const expireApprovals = defineService({
  name: "agents.expireApprovals",
  summary: "Lapse pending approvals nobody answered and release their tasks.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({}),
  output: row({ expired: z.number().int() }),
  handler: async (_input, ctx) => {
    const lapsed = await ctx.tx
      .update(runApprovals)
      .set({ status: "expired", decidedAt: sql`now()` })
      .where(
        and(
          eq(runApprovals.status, "pending"),
          sql`${runApprovals.expiresAt} <= now()`,
        ),
      )
      .returning({ id: runApprovals.id, taskId: runApprovals.subjectId });
    for (const row of new Map(lapsed.map((item) => [item.taskId, item])).values()) {
      await releaseTask(ctx, row.taskId);
    }
    for (const row of lapsed) {
      ctx.queueEvent("agentApproval.expired", { id: row.id, taskId: row.taskId });
    }
    return { expired: lapsed.length };
  },
});

export default [proposeWrite, listApprovals, approveWrite, rejectWrite, expireApprovals];
