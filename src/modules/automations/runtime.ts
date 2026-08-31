// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Starting, advancing, pausing and inspecting automation runs
// (MASTER.md §4.17, C9.02).
//
// The engine decides what one step does; this decides when a step happens and
// who it happens as. Three entry points wake a run, and they are the only
// three: an event arriving, the sweep finding a run whose wait has elapsed,
// and an owner asking.
//
// **Why a step is a transaction and a run is not.** A run spans days. Holding
// a transaction open across a two-day wait is not an option, and holding one
// across even a single `call` step would mean an automation's write and the
// run's own bookkeeping could not fail independently — which sounds desirable
// until the first verb throws and takes the record of its own failure with it.
// So each advance commits, and the run's row is the thing that survives.
import { z } from "zod";
import { and, asc, desc, eq, lte, sql } from "drizzle-orm";
import { listed, row, uuid as uuidSchema } from "@/core/contract";
import { defineService, ServiceError, type ServiceContext, type Tx } from "@/core/service";
import { registerContactReference } from "@/core/contacts/service";
import { registerContactPrivacySource } from "@/core/privacy/service";
import { runSteps, runs } from "@/core/runs/schema";
import { automationVerb } from "@/core/automations/verbs";
import {
  automationContactState,
  automationVersions,
  automations,
} from "./schema";
import { automationGraph, type AutomationGraph } from "./graph";
import { advance, completeCall, type RunRow } from "./engine";

const RUN_SUBJECT = "automation" as const;

const runRow = row({
  id: uuidSchema,
  subjectId: uuidSchema,
  subjectVersionId: uuidSchema.nullable(),
  contactId: uuidSchema.nullable(),
  status: z.enum(["running", "done", "failed", "cancelled"]),
  stopReason: z
    .enum(["done", "budget", "timeout", "refused", "error", "cancelled", "bounds"])
    .nullable(),
  stepCount: z.number().int(),
  resumeNodeId: z.string().nullable(),
  wakeAt: z.date().nullable(),
  startedAt: z.date(),
  endedAt: z.date().nullable(),
  error: z.string().nullable(),
});

function graphOf(value: unknown): AutomationGraph | null {
  const parsed = automationGraph.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/**
 * Whether this person may enter this automation again (§4.17).
 *
 * Reads and writes the same row, so it takes the transaction: two events for
 * the same contact arriving together must not both conclude "never entered".
 * The unique index is what makes the upsert safe.
 */
async function mayEnter(
  tx: Tx,
  automation: { id: string; reentry: string; cooldownDays: number | null },
  contactId: string | null,
  now: Date,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  // An automation with no contact has nobody to have entered before. A
  // schedule-triggered rule is meant to run every time it fires.
  if (!contactId || automation.reentry === "always") return { ok: true };

  const [state] = await tx
    .select()
    .from(automationContactState)
    .where(
      and(
        eq(automationContactState.automationId, automation.id),
        eq(automationContactState.contactId, contactId),
      ),
    );

  if (!state) return { ok: true };
  if (automation.reentry === "once") {
    return { ok: false, reason: "This automation runs once per person." };
  }
  if (state.cooldownUntil && state.cooldownUntil > now) {
    return { ok: false, reason: "This person is still inside the cooldown." };
  }
  return { ok: true };
}

async function recordEntry(
  tx: Tx,
  automation: { id: string; cooldownDays: number | null },
  contactId: string,
  now: Date,
): Promise<void> {
  const cooldownUntil = automation.cooldownDays
    ? new Date(now.getTime() + automation.cooldownDays * 86_400_000)
    : null;
  await tx
    .insert(automationContactState)
    .values({
      automationId: automation.id,
      contactId,
      entryCount: 1,
      lastEnteredAt: now,
      cooldownUntil,
    })
    .onConflictDoUpdate({
      target: [automationContactState.automationId, automationContactState.contactId],
      set: {
        entryCount: sql`${automationContactState.entryCount} + 1`,
        lastEnteredAt: now,
        cooldownUntil,
      },
    });
}

/**
 * Begin a run, or decline for a stated reason.
 *
 * Declining is a normal outcome, not an error: most events do not start most
 * automations, and an exception per non-match would make the bus noisy enough
 * that nobody would read it.
 */
export async function startRun(
  ctx: ServiceContext,
  input: {
    automationId: string;
    contactId?: string | null;
    trigger?: Record<string, unknown>;
    idempotencyKey?: string | null;
  },
): Promise<{ started: false; reason: string } | { started: true; runId: string }> {
  const now = new Date();
  const [automation] = await ctx.tx
    .select()
    .from(automations)
    .where(eq(automations.id, input.automationId));
  if (!automation) return { started: false, reason: "There is no such automation." };
  if (automation.status !== "active") {
    return { started: false, reason: "That automation is not switched on." };
  }
  if (!automation.currentVersionId) {
    return { started: false, reason: "That automation has never been published." };
  }

  const entry = await mayEnter(ctx.tx, automation, input.contactId ?? null, now);
  if (!entry.ok) return { started: false, reason: entry.reason };

  // `onConflictDoNothing` on the idempotency index rather than a prior check:
  // the outbox retries and a job re-runs its handler, and only the index holds
  // the race. A duplicate returns "already ran", not a second run.
  const [created] = await ctx.tx
    .insert(runs)
    .values({
      subjectKind: RUN_SUBJECT,
      subjectId: automation.id,
      // Pinned, so an automation edited next week does not change what this
      // run was doing (§4.17).
      subjectVersionId: automation.currentVersionId,
      contactId: input.contactId ?? null,
      agentId: null,
      status: "running",
      idempotencyKey: input.idempotencyKey ?? null,
    })
    .onConflictDoNothing()
    .returning({ id: runs.id });

  if (!created) {
    return { started: false, reason: "That event has already been handled." };
  }

  if (input.contactId) await recordEntry(ctx.tx, automation, input.contactId, now);
  ctx.queueEvent("automation.runStarted", {
    automationId: automation.id,
    runId: created.id,
  });
  return { started: true, runId: created.id };
}

/**
 * Take one step, and say what to do next.
 *
 * One step per call. A loop here would hold a transaction across a `wait` and
 * defeat the whole design; the caller decides whether to come straight back.
 */
export async function step(
  ctx: ServiceContext,
  runId: string,
): Promise<{ done: boolean; state: string; detail?: string }> {
  const [run] = await ctx.tx.select().from(runs).where(eq(runs.id, runId));
  if (!run) throw new ServiceError("not_found", "There is no such run.");
  if (run.status !== "running") return { done: true, state: run.status };

  const [version] = run.subjectVersionId
    ? await ctx.tx
        .select({ graph: automationVersions.graph })
        .from(automationVersions)
        .where(eq(automationVersions.id, run.subjectVersionId))
    : [];
  const graph = graphOf(version?.graph);
  if (!graph) {
    await fail(ctx, run.id, "error", "The version this run was following has gone.");
    return { done: true, state: "failed" };
  }

  const view: RunRow = {
    id: run.id,
    subjectId: run.subjectId,
    contactId: run.contactId,
    stepCount: run.stepCount,
    resumeNodeId: run.resumeNodeId,
    context: run.context,
  };
  const trigger = (run.context as { trigger?: Record<string, unknown> })?.trigger ?? {};

  const outcome = await advance(ctx.tx, view, graph, trigger);

  if (outcome.state === "call") {
    const node = graph.nodes.find((each) => each.id === outcome.nodeId)!;
    const verb = automationVerb(outcome.verbKey)!;
    try {
      // As the platform: an automation acts on the owner's behalf and holds no
      // session of its own. C9.03 puts consent, quiet hours, the budget and
      // the autonomy ladder in front of this call.
      const result = await ctx.callAsSystem(verb.service, outcome.input);
      await completeCall(ctx.tx, view, node, {
        serviceName: outcome.verbKey,
        input: outcome.input,
        output: result,
      });
    } catch (error) {
      const message =
        error instanceof ServiceError ? error.message : "That step failed.";
      await completeCall(ctx.tx, view, node, {
        serviceName: outcome.verbKey,
        input: outcome.input,
        error: message,
      });
      await fail(ctx, run.id, "error", message);
      return { done: true, state: "failed", detail: message };
    }
    if (outcome.next === null) {
      await finish(ctx, run.id);
      return { done: true, state: "done" };
    }
    return { done: false, state: "ran" };
  }

  if (outcome.state === "ran") {
    if (outcome.next === null) {
      await finish(ctx, run.id);
      return { done: true, state: "done" };
    }
    return { done: false, state: "ran" };
  }

  if (outcome.state === "sleeping") return { done: false, state: "sleeping" };
  if (outcome.state === "waiting") return { done: false, state: "waiting" };
  if (outcome.state === "stopped") {
    await fail(ctx, run.id, "bounds", outcome.detail);
    return { done: true, state: "stopped", detail: outcome.detail };
  }
  await finish(ctx, run.id);
  return { done: true, state: "done" };
}

async function finish(ctx: ServiceContext, runId: string): Promise<void> {
  await ctx.tx
    .update(runs)
    .set({ status: "done", stopReason: "done", endedAt: new Date(), wakeAt: null })
    .where(eq(runs.id, runId));
  ctx.queueEvent("automation.runFinished", { runId });
}

async function fail(
  ctx: ServiceContext,
  runId: string,
  reason: "error" | "bounds",
  detail: string,
): Promise<void> {
  await ctx.tx
    .update(runs)
    .set({
      status: "failed",
      stopReason: reason,
      error: detail,
      endedAt: new Date(),
      wakeAt: null,
    })
    .where(eq(runs.id, runId));
  ctx.queueEvent("automation.runFailed", { runId, reason, detail });
}

/**
 * Advance a run until it has to stop.
 *
 * Bounded by the graph's own ceiling, which `advance` checks before every
 * step, so this cannot spin: the worst case is `maxSteps` iterations and then
 * a stated stop.
 */
export async function drive(
  ctx: ServiceContext,
  runId: string,
): Promise<{ steps: number; state: string }> {
  let taken = 0;
  for (;;) {
    const outcome = await step(ctx, runId);
    taken += 1;
    if (outcome.done || outcome.state !== "ran") {
      return { steps: taken, state: outcome.state };
    }
  }
}

/* ------------------------------------------------------------- services */

export const runNow = defineService({
  name: "automations.run",
  writeClass: "write",
  summary: "Start an automation by hand and drive it as far as it will go.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    automationId: uuidSchema,
    contactId: uuidSchema.nullish(),
  }),
  output: row({
    started: z.boolean(),
    reason: z.string().nullable(),
    runId: uuidSchema.nullable(),
    state: z.string().nullable(),
  }),
  handler: async (input, ctx) => {
    const begun = await startRun(ctx, {
      automationId: input.automationId,
      contactId: input.contactId ?? null,
      trigger: {},
    });
    if (!begun.started) {
      return { started: false, reason: begun.reason, runId: null, state: null };
    }
    const driven = await drive(ctx, begun.runId);
    ctx.setSubject("automation", input.automationId);
    return { started: true, reason: null, runId: begun.runId, state: driven.state };
  },
});

/**
 * Wake every run whose wait has elapsed.
 *
 * A sweep rather than a timer per run: §4.17 stores a wake time, and the
 * cheapest correct reader of a wake time is a range scan on an index. Missing
 * a window makes a run late, never lost.
 */
export async function wakeDue(ctx: ServiceContext, limit = 50): Promise<number> {
  const due = await ctx.tx
    .select({ id: runs.id })
    .from(runs)
    .where(
      and(
        eq(runs.subjectKind, RUN_SUBJECT),
        eq(runs.status, "running"),
        lte(runs.wakeAt, new Date()),
      ),
    )
    .orderBy(asc(runs.wakeAt))
    .limit(limit);

  for (const each of due) {
    // Cleared first: a run that wakes and immediately sleeps again writes a
    // new wake time, and one that finishes must not be picked up next sweep.
    await ctx.tx.update(runs).set({ wakeAt: null }).where(eq(runs.id, each.id));
    await drive(ctx, each.id);
  }
  return due.length;
}

export const wake = defineService({
  name: "automations.wake",
  writeClass: "write",
  summary: "Advance automation runs whose wait has elapsed (§4.17).",
  kind: "mutation",
  permission: "system",
  input: z.object({ limit: z.number().int().min(1).max(200).default(50) }),
  output: row({ woken: z.number().int() }),
  handler: async (input, ctx) => ({ woken: await wakeDue(ctx, input.limit) }),
});

export const killRun = defineService({
  name: "automations.killRun",
  writeClass: "destructive",
  summary: "Stop a run where it stands.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({ runId: uuidSchema, reason: z.string().trim().max(300).nullish() }),
  output: row({ runId: uuidSchema, status: z.string() }),
  handler: async (input, ctx) => {
    const [stopped] = await ctx.tx
      .update(runs)
      .set({
        status: "cancelled",
        stopReason: "cancelled",
        error: input.reason ?? "Stopped by the owner.",
        endedAt: new Date(),
        wakeAt: null,
      })
      .where(and(eq(runs.id, input.runId), eq(runs.status, "running")))
      .returning({ id: runs.id, status: runs.status });
    if (!stopped) throw new ServiceError("conflict", "That run is not active.");
    ctx.queueEvent("automation.runKilled", { runId: stopped.id });
    return { runId: stopped.id, status: stopped.status };
  },
});

export const listRuns = defineService({
  name: "automations.runs",
  summary: "Runs of an automation, newest first.",
  kind: "query",
  permission: "scoped",
  input: z.object({
    automationId: uuidSchema.optional(),
    status: z.enum(["running", "done", "failed", "cancelled"]).optional(),
    limit: z.number().int().min(1).max(200).default(50),
  }),
  output: listed(runRow),
  handler: (input, ctx) =>
    ctx.tx
      .select({
        id: runs.id,
        subjectId: runs.subjectId,
        subjectVersionId: runs.subjectVersionId,
        contactId: runs.contactId,
        status: runs.status,
        stopReason: runs.stopReason,
        stepCount: runs.stepCount,
        resumeNodeId: runs.resumeNodeId,
        wakeAt: runs.wakeAt,
        startedAt: runs.startedAt,
        endedAt: runs.endedAt,
        error: runs.error,
      })
      .from(runs)
      .where(
        and(
          eq(runs.subjectKind, RUN_SUBJECT),
          input.automationId ? eq(runs.subjectId, input.automationId) : undefined,
          input.status ? eq(runs.status, input.status) : undefined,
        ),
      )
      .orderBy(desc(runs.startedAt))
      .limit(input.limit),
});

export const inspectRun = defineService({
  name: "automations.inspectRun",
  summary: "One run and every step it took, in order.",
  kind: "query",
  permission: "scoped",
  input: z.object({ runId: uuidSchema }),
  output: row({
    run: runRow,
    steps: listed(
      row({
        seq: z.number().int(),
        kind: z.string(),
        nodeId: z.string().nullable(),
        serviceName: z.string().nullable(),
        output: z.unknown(),
        error: z.string().nullable(),
        at: z.date(),
      }),
    ),
  }),
  handler: async (input, ctx) => {
    const [found] = await ctx.tx
      .select()
      .from(runs)
      .where(and(eq(runs.id, input.runId), eq(runs.subjectKind, RUN_SUBJECT)));
    if (!found) throw new ServiceError("not_found", "There is no such run.");
    const steps = await ctx.tx
      .select({
        seq: runSteps.seq,
        kind: runSteps.kind,
        nodeId: runSteps.nodeId,
        serviceName: runSteps.serviceName,
        output: runSteps.output,
        error: runSteps.error,
        at: runSteps.createdAt,
      })
      .from(runSteps)
      .where(eq(runSteps.runId, found.id))
      .orderBy(asc(runSteps.seq));
    return { run: found, steps };
  },
});

/* ------------------------------------------------------------ the spine */

registerContactReference({
  table: "automation_contact_state",
  // One row per person per automation, so a merge between two people who have
  // both entered would collide. The survivor's history wins and the
  // duplicate's is folded in: the counts add, and the later cooldown stands,
  // because the point of a cooldown is the promise not to contact somebody
  // again too soon and the stricter of two promises is the one to keep.
  repoint: async (tx, duplicateId, survivingId) => {
    const mine = await tx
      .select()
      .from(automationContactState)
      .where(eq(automationContactState.contactId, duplicateId));
    for (const state of mine) {
      const [survivor] = await tx
        .select()
        .from(automationContactState)
        .where(
          and(
            eq(automationContactState.automationId, state.automationId),
            eq(automationContactState.contactId, survivingId),
          ),
        );
      if (!survivor) {
        await tx
          .update(automationContactState)
          .set({ contactId: survivingId })
          .where(eq(automationContactState.id, state.id));
        continue;
      }
      const later = (a: Date | null, b: Date | null) =>
        a && b ? (a > b ? a : b) : (a ?? b);
      await tx
        .update(automationContactState)
        .set({
          entryCount: survivor.entryCount + state.entryCount,
          lastEnteredAt: later(survivor.lastEnteredAt, state.lastEnteredAt),
          cooldownUntil: later(survivor.cooldownUntil, state.cooldownUntil),
        })
        .where(eq(automationContactState.id, survivor.id));
      await tx
        .delete(automationContactState)
        .where(eq(automationContactState.id, state.id));
    }
  },
  captureForUndo: async (tx, duplicateId, survivingId) => {
    const mine = await tx
      .select({ id: automationContactState.id, automationId: automationContactState.automationId })
      .from(automationContactState)
      .where(eq(automationContactState.contactId, duplicateId));
    let collides = false;
    for (const state of mine) {
      const [clash] = await tx
        .select({ id: automationContactState.id })
        .from(automationContactState)
        .where(
          and(
            eq(automationContactState.automationId, state.automationId),
            eq(automationContactState.contactId, survivingId),
          ),
        );
      if (clash) {
        collides = true;
        break;
      }
    }
    return {
      state: mine,
      // Only a collision loses information. Moving a row is reversible, and
      // the common case — one of the two people never entered — must stay
      // undoable, or this table would quietly make every merge permanent.
      undoable: !collides,
      ...(collides
        ? {
            blocker:
              "Both people had entered the same automation, and merging added their histories together.",
          }
        : {}),
    };
  },
  restoreAfterUndo: async (tx, beforeState, _afterState, duplicateId) => {
    const rows = z
      .array(z.object({ id: z.string().uuid() }))
      .parse(beforeState);
    for (const each of rows) {
      await tx
        .update(automationContactState)
        .set({ contactId: duplicateId })
        .where(eq(automationContactState.id, each.id));
    }
  },
});

registerContactPrivacySource({
  scope: "contact.automations",
  tables: ["automation_contact_state"],
  exportData: async (tx, contactId) => ({
    automations: await tx
      .select({
        automationId: automationContactState.automationId,
        entryCount: automationContactState.entryCount,
        lastEnteredAt: automationContactState.lastEnteredAt,
        cooldownUntil: automationContactState.cooldownUntil,
      })
      .from(automationContactState)
      .where(eq(automationContactState.contactId, contactId)),
  }),
  erase: async (tx, contactId) => {
    // Deleted outright, unlike a run. This row exists only to answer "has this
    // person been through this automation before" — it is a fact *about* the
    // person and nothing else, with no effect of its own left behind needing
    // an explanation. Once they are erased there is nobody for it to be about.
    const removed = await tx
      .delete(automationContactState)
      .where(eq(automationContactState.contactId, contactId))
      .returning({ id: automationContactState.id });
    return { affected: removed.length };
  },
});

export { RUN_SUBJECT };
