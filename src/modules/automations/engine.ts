// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Running an automation, one step at a time (MASTER.md §4.17, C9.02).
//
// The shape to understand first: **this executes one step per call and then
// returns.** It is not a loop that runs a graph to completion. A run advances
// when something asks it to — an event arriving, the wake sweep finding it, an
// approval being granted — and between those moments it is a row.
//
// That is §4.17's "waiting is a row, not a held process" taken seriously. A
// held process loses a two-day delay to a deploy; a row survives one. It also
// means a stuck automation cannot occupy a worker, and that a run can be
// paused, killed or inspected between any two steps without anything having to
// be interrupted.
//
// The cost is that every piece of state a step needs must be written down
// rather than held in a closure: which node comes next, what earlier steps
// produced, how many steps have run. That is what `resume_node_id`, `context`
// and `step_count` are for, and why they are on the run rather than derived.
import { and, eq, sql } from "drizzle-orm";
import { redact, type Tx } from "@/core/service";
import { runSteps, runs } from "@/core/runs/schema";
import { automationVerb } from "@/core/automations/verbs";
import type { AutomationGraph, AutomationNode } from "./graph";

/** Why an advance stopped, so the caller knows whether to come back. */
export type Advance =
  | { state: "ran"; nodeId: string; next: string | null }
  /**
   * A verb is due. The engine will not dispatch it: that needs an actor and a
   * transaction, which belong to whoever owns this one rather than to a pure
   * interpreter. The caller executes, then calls `completeCall` — so the step
   * row records what actually happened rather than what was about to.
   */
  | {
      state: "call";
      nodeId: string;
      next: string | null;
      verbKey: string;
      input: unknown;
    }
  | { state: "sleeping"; wakeAt: Date }
  | { state: "waiting"; approvalFor: string }
  | { state: "finished"; reason: "done" | "stop" }
  | { state: "stopped"; reason: "bounds"; detail: string };

export interface RunRow {
  id: string;
  subjectId: string;
  contactId: string | null;
  stepCount: number;
  resumeNodeId: string | null;
  context: unknown;
}

/** The run's own record of what earlier steps produced. */
function contextOf(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

function nodeById(graph: AutomationGraph, id: string): AutomationNode | null {
  return graph.nodes.find((node) => node.id === id) ?? null;
}

/**
 * Read a path like `trigger.totalMinor` or `steps.draft` out of the run.
 *
 * Dotted lookup and nothing else — no expressions, no operators, no calls.
 * §4.17 makes conditions data rather than code, and the moment this could
 * evaluate an expression, a saved automation would be a saved program and a
 * graph would need a sandbox instead of a validator.
 */
export function readPath(source: Record<string, unknown>, path: string): unknown {
  let current: unknown = source;
  for (const key of path.split(".")) {
    if (typeof current !== "object" || current === null) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

/** One branch arm, decided. Pure, so a test can state the whole truth table. */
export function armMatches(
  op: string,
  found: unknown,
  wanted: unknown,
): boolean {
  switch (op) {
    case "exists":
      return found !== undefined && found !== null;
    case "absent":
      return found === undefined || found === null;
    case "eq":
      return found === wanted;
    case "ne":
      return found !== wanted;
    case "contains":
      if (Array.isArray(found)) return found.includes(wanted);
      return (
        typeof found === "string" && typeof wanted === "string" && found.includes(wanted)
      );
    default:
      break;
  }
  // The ordered comparisons, and only between numbers. Comparing a string to a
  // number with `>` is a question with no honest answer, and JavaScript's is
  // worse than none — so an ill-typed comparison is false rather than
  // surprising, and the branch takes its `otherwise`.
  if (typeof found !== "number" || typeof wanted !== "number") return false;
  switch (op) {
    case "gt":
      return found > wanted;
    case "gte":
      return found >= wanted;
    case "lt":
      return found < wanted;
    case "lte":
      return found <= wanted;
    default:
      return false;
  }
}

/**
 * How many times a loop has already gone round, from the steps it wrote.
 *
 * Counted from history rather than held in the run, because the run is
 * reloaded between every step: a counter in memory would reset on the first
 * restart and the loop would become unbounded — which is precisely the failure
 * §4.17 refuses at validation time and must also refuse at run time.
 */
async function iterationsSoFar(tx: Tx, runId: string, nodeId: string): Promise<number> {
  const [counted] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(runSteps)
    .where(and(eq(runSteps.runId, runId), eq(runSteps.nodeId, nodeId)));
  return counted?.n ?? 0;
}

async function writeStep(
  tx: Tx,
  run: RunRow,
  node: AutomationNode,
  fields: {
    serviceName?: string | null;
    input?: unknown;
    output?: unknown;
    error?: string | null;
  },
): Promise<void> {
  await tx.insert(runSteps).values({
    runId: run.id,
    seq: run.stepCount + 1,
    kind: node.kind,
    nodeId: node.id,
    serviceName: fields.serviceName ?? null,
    // Redacted on write, the same rule the audit trail uses: a step is read by
    // an owner inspecting a run, and a secret that reached this table would be
    // in every screenshot of it thereafter.
    input: redact(fields.input) ?? null,
    output: redact(fields.output) ?? null,
    error: fields.error ?? null,
  });
}

/**
 * Advance one run by one step.
 *
 * Returns what happened rather than throwing, because every outcome here is a
 * state the owner can see: a run that hit its ceiling is not an exception, it
 * is a run that stopped for a stated reason (§40's "failure is a state").
 */
export async function advance(
  tx: Tx,
  run: RunRow,
  graph: AutomationGraph,
  trigger: Record<string, unknown>,
  now: Date = new Date(),
): Promise<Advance> {
  const nodeId = run.resumeNodeId ?? graph.entry;
  const node = nodeById(graph, nodeId);
  if (!node) return { state: "finished", reason: "done" };

  // The ceiling, checked before the step rather than after. §4.17 bounds a run
  // by `maxSteps`; checking afterwards would let a graph take one step more
  // than it declared, every time.
  if (run.stepCount >= graph.maxSteps) {
    return {
      state: "stopped",
      reason: "bounds",
      detail: `This automation stopped after ${graph.maxSteps} steps.`,
    };
  }

  const context = contextOf(run.context);
  const scope: Record<string, unknown> = { trigger, steps: context };

  switch (node.kind) {
    case "wait": {
      // The delay is recorded, not slept through. A run that is asleep is a
      // row with a wake time, so a restart costs nothing.
      const wakeAt = new Date(now.getTime() + node.minutes * 60_000);
      await writeStep(tx, run, node, { output: { wakeAt: wakeAt.toISOString() } });
      await tx
        .update(runs)
        .set({
          wakeAt,
          resumeNodeId: node.next,
          stepCount: run.stepCount + 1,
        })
        .where(eq(runs.id, run.id));
      return { state: "sleeping", wakeAt };
    }

    case "branch": {
      const taken = node.arms.find((arm) =>
        armMatches(arm.op, readPath(scope, arm.path), arm.value),
      );
      const next = taken?.then ?? node.otherwise;
      await writeStep(tx, run, node, {
        output: { matched: taken?.path ?? null, next },
      });
      await tx
        .update(runs)
        .set({ resumeNodeId: next, stepCount: run.stepCount + 1 })
        .where(eq(runs.id, run.id));
      return { state: "ran", nodeId: node.id, next };
    }

    case "loop": {
      const done = await iterationsSoFar(tx, run.id, node.id);
      // The bound, enforced from what actually happened. `>=` rather than `>`
      // because a loop declaring five iterations should run five, not six.
      const next = done >= node.maxIterations ? node.next : node.body;
      await writeStep(tx, run, node, {
        output: { iteration: done + 1, of: node.maxIterations, next },
      });
      await tx
        .update(runs)
        .set({ resumeNodeId: next, stepCount: run.stepCount + 1 })
        .where(eq(runs.id, run.id));
      return { state: "ran", nodeId: node.id, next };
    }

    case "gate": {
      // The run holds here. C9.03 decides *whether* a gate is needed from
      // consent, budget and the autonomy ladder; this one is the owner saying
      // "always ask me", which is a stronger statement than the ladder's.
      await writeStep(tx, run, node, { output: { reason: node.reason ?? null } });
      await tx
        .update(runs)
        .set({ resumeNodeId: node.next, stepCount: run.stepCount + 1 })
        .where(eq(runs.id, run.id));
      return { state: "waiting", approvalFor: node.id };
    }

    case "stop": {
      await writeStep(tx, run, node, { output: { reason: node.reason ?? null } });
      await tx
        .update(runs)
        .set({ resumeNodeId: null, stepCount: run.stepCount + 1 })
        .where(eq(runs.id, run.id));
      return { state: "finished", reason: "stop" };
    }

    case "prompt":
    case "playbook": {
      // Recorded and skipped for now. C9.02 is the deterministic runtime; the
      // prompt rung needs an agent, a budget check and §40's ladder, which is
      // C9.03's work. Writing the step anyway keeps the history honest: the
      // run really did reach this node.
      await writeStep(tx, run, node, {
        output: { pending: "prompt steps run once the agent rung is wired (C9.03)" },
      });
      await tx
        .update(runs)
        .set({ resumeNodeId: node.next, stepCount: run.stepCount + 1 })
        .where(eq(runs.id, run.id));
      return { state: "ran", nodeId: node.id, next: node.next };
    }

    case "call": {
      const verb = automationVerb(node.verb);
      if (!verb) {
        // Validation refuses this at publish, so reaching it means a module was
        // uninstalled after the automation was switched on. A stated stop, not
        // a crash: the owner needs to know which verb went.
        await writeStep(tx, run, node, {
          serviceName: node.verb,
          error: `Nothing installed can do "${node.verb}" any more.`,
        });
        await tx
          .update(runs)
          .set({ resumeNodeId: null, stepCount: run.stepCount + 1 })
          .where(eq(runs.id, run.id));
        return {
          state: "stopped",
          reason: "bounds",
          detail: `"${node.verb}" is no longer installed.`,
        };
      }
      return {
        state: "call",
        nodeId: node.id,
        next: node.next,
        verbKey: verb.key,
        input: verb.buildInput(node.params, {
          contactId: run.contactId,
          trigger,
          steps: context,
        }),
      };
    }

    default:
      return { state: "finished", reason: "done" };
  }
}

/**
 * Record what a dispatched verb did, and move the run on.
 *
 * Called after the verb has actually run, so the step says what happened
 * rather than what was intended — the difference that matters the first time
 * one of them throws.
 */
export async function completeCall(
  tx: Tx,
  run: RunRow,
  node: AutomationNode,
  outcome: { serviceName: string; input: unknown; output?: unknown; error?: string },
): Promise<void> {
  await writeStep(tx, run, node, {
    serviceName: outcome.serviceName,
    input: outcome.input,
    output: outcome.output,
    error: outcome.error ?? null,
  });
  await tx
    .update(runs)
    .set({
      // A failed step stops the run where it stands: `resumeNodeId` stays put
      // so an owner reading the row can see which node it died on.
      resumeNodeId: outcome.error ? node.id : (node.kind === "call" ? node.next : null),
      stepCount: run.stepCount + 1,
    })
    .where(eq(runs.id, run.id));
}
