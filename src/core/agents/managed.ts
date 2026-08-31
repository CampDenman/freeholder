// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The managed agent loop (C4.05 slice 2, MASTER.md §40).
//
// A managed connection means the platform runs the loop, and that sentence is
// the security model: every call the model asks for is made *by this file*,
// as the agent's own actor, through the ordinary choke point — reads via the
// service registry under the agent's scopes, writes only ever through
// `agents.proposeWrite`, where C4.03's autonomy gate decides execute, propose
// or park. The model cannot sidestep the gate because the model never makes a
// call; it only asks.
//
// Convergence is deliberate everywhere else too: work is taken with the same
// `agents.claimTask` an inbound runtime uses, narrated with the same
// `agents.reportStep`, finished with the same `agents.completeTask`, and the
// tool surface offered to the model is exactly `mcp/tools.toolsFor` — the
// same capability list an MCP client would see. An owner watching the screen
// cannot tell which kind of agent is working, which is §40's stated goal.
import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/core/db";
import { redact, ServiceError, type Actor } from "@/core/service";
import { apiKeys } from "@/core/apikeys/schema";
import { agentConnections, agents } from "@/core/agents/schema";
import { runs } from "@/core/runs/schema";
import { claimTask, completeTask, reportStep } from "@/core/agents/execution";
import { proposeWrite } from "@/core/agents/writes";
import {
  budgetRefusalMessage,
  resolveRunBudget,
  type RunBudget,
} from "@/core/agents/budget";
import { estimateNextTurnCents, turnCostCents } from "@/core/agents/pricing";
import { notifyBudget, notifyCannotSpend } from "@/core/agents/budget-alerts";
import { untrustedEnvelope } from "@/core/agents/envelope";
import { serviceForTool, toolsFor } from "@/mcp/tools";
import { workforceAdapter } from "@/adapters/agent/workforce";
import type {
  WorkforceAgentAdapter,
  WorkforceMessage,
  WorkforceToolCall,
} from "@/adapters/agent/workforce-types";
import type { AgentToolDefinition } from "@/adapters/agent/types";

/** Model turns per run. A loop this long that has not finished is lost. */
export const MANAGED_MAX_STEPS = 24;
/** Wall clock per run, safely inside the ten-minute claim lease. */
export const MANAGED_MAX_WALL_MS = 8 * 60_000;
/** Runs one job tick will execute; the rest wait a minute for the next. */
const RUNS_PER_TICK = 3;
const MAX_OUTPUT_TOKENS_PER_TURN = 4_000;
/** Below this a turn cannot say anything useful; stop instead of trying. */
const MIN_OUTPUT_TOKENS_PER_TURN = 256;
/** Characters of a tool result the model is shown. Data, not a firehose. */
const TOOL_RESULT_LIMIT = 8_000;

interface ManagedWorker {
  agentId: string;
  agentName: string;
  actor: Actor;
  budgetCents: number;
  budgetPeriod: "day" | "week" | "month";
  connection: {
    adapter: string | null;
    model: string | null;
    credentialRef: string | null;
    baseUrl: string | null;
    inputCentsPerMillion: number | null;
    outputCentsPerMillion: number | null;
  };
}

/** Every active worker on an active managed connection, with its own key. */
async function managedWorkers(): Promise<ManagedWorker[]> {
  const rows = await db()
    .select({
      agentId: agents.id,
      agentName: agents.name,
      keyName: apiKeys.name,
      scopes: apiKeys.scopes,
      budgetCents: agents.budgetCents,
      budgetPeriod: agents.budgetPeriod,
      adapter: agentConnections.adapter,
      model: agentConnections.model,
      credentialRef: agentConnections.credentialRef,
      baseUrl: agentConnections.baseUrl,
      inputCentsPerMillion: agentConnections.inputCentsPerMillion,
      outputCentsPerMillion: agentConnections.outputCentsPerMillion,
    })
    .from(agents)
    .innerJoin(agentConnections, eq(agentConnections.id, agents.connectionId))
    .innerJoin(apiKeys, eq(apiKeys.id, agents.apiKeyId))
    .where(
      and(
        eq(agents.status, "active"),
        eq(agentConnections.status, "active"),
        eq(agentConnections.kind, "managed"),
      ),
    );
  return rows.map((row) => ({
    agentId: row.agentId,
    agentName: row.agentName,
    actor: { kind: "agent", keyName: row.keyName, scopes: row.scopes ?? [] },
    budgetCents: row.budgetCents,
    budgetPeriod: row.budgetPeriod,
    connection: {
      adapter: row.adapter,
      model: row.model,
      credentialRef: row.credentialRef,
      baseUrl: row.baseUrl,
      inputCentsPerMillion: row.inputCentsPerMillion,
      outputCentsPerMillion: row.outputCentsPerMillion,
    },
  }));
}

/**
 * How many output tokens this run can still pay for.
 *
 * Asking for fewer tokens than the ceiling is the difference between a budget
 * that *reports* an overspend and one that prevents it: the provider will not
 * bill for output it was never allowed to produce.
 */
function affordableOutputTokens(
  budget: RunBudget,
  spentCents: number,
  ceiling: number,
): number {
  const left = budget.remainingCents - spentCents;
  if (left <= 0) return 0;
  const perMillion = budget.price.outputCentsPerMillion;
  if (perMillion <= 0) return ceiling;
  // Integer arithmetic throughout: cents × 1e6 / (cents per million tokens).
  const affordable = Math.floor((left * 1_000_000) / perMillion);
  return Math.min(ceiling, affordable);
}

/**
 * Is this run still ours to continue?
 *
 * Read fresh from the database rather than trusted from memory: a pause, a
 * stop button or an expired lease all end a run from outside this process,
 * and the loop is the last place that should find out.
 */
async function stillRunning(runId: string): Promise<boolean> {
  const [run] = await db()
    .select({ status: runs.status })
    .from(runs)
    .where(eq(runs.id, runId))
    .limit(1);
  return run?.status === "running";
}

/** The price the owner set on this connection, if they set one. */
function priceOverride(worker: ManagedWorker) {
  return {
    ...(worker.connection.inputCentsPerMillion !== null
      ? { inputCentsPerMillion: worker.connection.inputCentsPerMillion }
      : {}),
    ...(worker.connection.outputCentsPerMillion !== null
      ? { outputCentsPerMillion: worker.connection.outputCentsPerMillion }
      : {}),
  };
}

type Claim = NonNullable<Awaited<ReturnType<(typeof claimTask)["call"]>>>;

/**
 * The durable frame the model works inside. The claim's own `guidance` line
 * carries the autonomy rung and the untrusted-input rule — the same sentence
 * an inbound agent is told.
 */
function systemPrompt(claim: Claim): string {
  return [
    `You are ${claim.agent.name}, a worker for this business. Role: ${claim.agent.role}.`,
    claim.agent.instructions,
    "",
    "You work only through the tools you are given. Reads answer directly.",
    "Anything that changes data is routed through this platform's approval",
    "gate: it may execute, be recorded as a proposal, or wait for the owner —",
    "the tool result tells you which. When a change is parked for approval,",
    "finish up: summarise what you prepared and stop.",
    "",
    claim.guidance,
    "",
    "When the work is done, reply with a short plain-text summary and no",
    "tool calls.",
  ].join("\n");
}

/** The task, with untrusted input fenced as quoted data (§40). */
function taskMessage(claim: Claim, marker: string): string {
  const input =
    claim.task.input === null || claim.task.input === undefined
      ? null
      : JSON.stringify(claim.task.input, null, 2);
  return [
    `Task: ${claim.task.title}`,
    claim.task.brief ? `Brief: ${claim.task.brief}` : null,
    input
      ? claim.task.inputTrust === "untrusted"
        ? untrustedEnvelope(input, { label: "input", marker }).text
        : `Input:\n${input}`
      : null,
  ]
    .filter(Boolean)
    .join("\n\n");
}

function clip(value: unknown): string {
  const text = JSON.stringify(redact(value) ?? null);
  return text.length > TOOL_RESULT_LIMIT
    ? `${text.slice(0, TOOL_RESULT_LIMIT)}…(truncated)`
    : text;
}

/**
 * One tool call, decided by the platform.
 *
 * Queries run directly under the agent's own actor — `service.call` re-checks
 * scopes, so the tool list and the permission decision cannot disagree.
 * Mutations never run directly from here: they go to `agents.proposeWrite`,
 * whose classification and autonomy rules are the enforcement §40 promises
 * for managed execution.
 */
async function performToolCall(
  worker: ManagedWorker,
  runId: string,
  call: WorkforceToolCall,
): Promise<{ content: string; parked: boolean }> {
  const service = serviceForTool(worker.actor, call.name);
  if (!service) {
    return {
      content: JSON.stringify({
        error: `No tool called ${call.name} is available to your key.`,
      }),
      parked: false,
    };
  }
  try {
    if (service.def.kind === "query") {
      const result = await service.call(call.arguments ?? {}, worker.actor);
      return { content: clip(result), parked: false };
    }
    const decision = await proposeWrite.call(
      {
        runId,
        serviceName: service.def.name,
        input: (call.arguments ?? {}) as Record<string, unknown>,
      },
      worker.actor,
    );
    if (decision.outcome === "executed") {
      return { content: clip({ executed: true, result: decision.result }), parked: false };
    }
    if (decision.outcome === "proposed") {
      return {
        content: JSON.stringify({
          proposed: true,
          note: "Recorded as a proposal for the owner to review. Nothing was changed.",
        }),
        parked: false,
      };
    }
    return {
      content: JSON.stringify({
        awaitingApproval: true,
        note: "Parked for the owner's approval. Nothing runs until they decide — summarise and stop.",
      }),
      parked: true,
    };
  } catch (error) {
    const message =
      error instanceof ServiceError ? error.message : "The call failed.";
    return { content: JSON.stringify({ error: message }), parked: false };
  }
}

interface RunTally {
  tokensIn: number;
  tokensOut: number;
  turns: number;
  /** Priced as it goes, so a stop knows what the run already owes. */
  costCents: number;
  largestInputTokens: number;
}

async function record(
  worker: ManagedWorker,
  runId: string,
  step: {
    kind: "message" | "tool_call" | "tool_result" | "note";
    serviceName?: string | null;
    input?: Record<string, unknown> | null;
    output?: Record<string, unknown> | null;
    error?: string | null;
  },
): Promise<void> {
  // Tokens are settled once, at completeTask — reportStep would add them to
  // the run a second time.
  await reportStep.call({ runId, tokens: 0, ...step }, worker.actor);
}

async function finish(
  worker: ManagedWorker,
  runId: string,
  tally: RunTally,
  end:
    | { outcome: "done"; result: Record<string, unknown> }
    | { outcome: "failed"; failureReason: string; stopReason?: "timeout" | "budget" }
    | { outcome: "refused"; failureReason: string },
): Promise<void> {
  await completeTask.call(
    {
      runId,
      outcome: end.outcome,
      result: end.outcome === "done" ? end.result : undefined,
      failureReason: end.outcome === "done" ? undefined : end.failureReason,
      stopReason: end.outcome === "failed" ? end.stopReason : undefined,
      tokensIn: tally.tokensIn,
      tokensOut: tally.tokensOut,
      // What the turns actually cost at this connection's price. The spend
      // ledger and every budget check downstream read this number.
      costCents: tally.costCents,
    },
    worker.actor,
  );
  // Told after the money is recorded, so the figure an owner is shown is the
  // one in the ledger rather than one about to change.
  await notifyBudget(worker, tally.costCents).catch(() => undefined);
}

/** Execute one claimed task to its end. Exported for the tests. */
export async function executeManagedRun(
  worker: ManagedWorker,
  claim: Claim,
  adapter: WorkforceAgentAdapter = workforceAdapter(worker.connection),
): Promise<void> {
  const model = worker.connection.model ?? adapter.defaultModel;
  const tally: RunTally = {
    tokensIn: 0,
    tokensOut: 0,
    turns: 0,
    costCents: 0,
    largestInputTokens: 0,
  };
  const startedAt = Date.now();
  const tools: AgentToolDefinition[] = toolsFor(worker.actor).map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    },
  }));
  // One marker per run: consistent across the transcript, unguessable to
  // anything that wrote the data being quoted.
  const fenceMarker = `untrusted-${randomBytes(9).toString("hex")}`;
  const transcript: WorkforceMessage[] = [
    { role: "user", content: taskMessage(claim, fenceMarker) },
  ];

  if (!model) {
    await finish(worker, claim.runId, tally, {
      outcome: "failed",
      failureReason: "The connection names no model and its adapter has no default.",
    });
    return;
  }

  // Money is resolved before the first turn, not after the last: §40 wants the
  // cap checked ahead of each step, and a run that cannot afford its opening
  // turn should never make it.
  const resolved = await resolveRunBudget({
    agentId: worker.agentId,
    budgetCents: worker.budgetCents,
    budgetPeriod: worker.budgetPeriod,
    taskId: claim.task.id,
    taskBudgetCents: claim.task.budgetCents ?? null,
    model,
    priceOverride: priceOverride(worker),
  });
  if ("refusal" in resolved) {
    await finish(worker, claim.runId, tally, {
      outcome: "failed",
      failureReason: budgetRefusalMessage(resolved.refusal, worker.agentName),
      stopReason: "budget",
    });
    return;
  }
  const budget: RunBudget = resolved.budget;

  try {
    for (;;) {
      if (tally.turns >= MANAGED_MAX_STEPS) {
        await finish(worker, claim.runId, tally, {
          outcome: "failed",
          failureReason: `The run used all ${MANAGED_MAX_STEPS} model turns without finishing.`,
          stopReason: "timeout",
        });
        return;
      }
      if (Date.now() - startedAt > MANAGED_MAX_WALL_MS) {
        await finish(worker, claim.runId, tally, {
          outcome: "failed",
          failureReason: "The run hit its wall-clock limit.",
          stopReason: "timeout",
        });
        return;
      }

      // The kill switch, felt within one turn (C4.07). Pausing an agent ends
      // its runs and hands the work back; a loop that kept going would be
      // doing exactly what the owner just stopped, and would then overwrite
      // the re-queued task when it finished. Checked before spending money
      // rather than after.
      if (!(await stillRunning(claim.runId))) return;

      // The check §40 asks for, before the step rather than after it: what
      // this turn could cost at worst, against what the run has left.
      //
      // The output half is *made* affordable rather than merely checked — a
      // turn is asked for only as many tokens as the remaining budget can
      // pay for. The input half cannot be known before sending, so it is
      // estimated from the largest input this run has seen (a transcript
      // only grows) with a floor. That leaves exactly one exposure: a first
      // turn whose real input dwarfs the floor can overshoot by one turn.
      // It is then recorded in full and blocks every further claim, which is
      // the honest bound — not a silent one.
      const affordableOutput = affordableOutputTokens(
        budget,
        tally.costCents,
        MAX_OUTPUT_TOKENS_PER_TURN,
      );
      const estimate = estimateNextTurnCents(budget.price, {
        largestInputTokens: tally.largestInputTokens,
        maxOutputTokens: affordableOutput,
      });
      if (affordableOutput < MIN_OUTPUT_TOKENS_PER_TURN || tally.costCents + estimate > budget.remainingCents) {
        await finish(worker, claim.runId, tally, {
          outcome: "failed",
          failureReason:
            tally.turns === 0
              ? `${worker.agentName} cannot afford a single turn within its remaining budget (${budget.remainingCents} cents).`
              : `The run stopped at its budget: ${tally.costCents} cents spent, ${budget.remainingCents} available, and the next turn could cost ${estimate}.`,
          stopReason: "budget",
        });
        return;
      }

      tally.turns += 1;
      const turn = await adapter.turn({
        model,
        system: systemPrompt(claim),
        messages: transcript,
        tools,
        maxOutputTokens: affordableOutput,
        requestId: claim.runId,
      });
      tally.tokensIn += turn.usage.inputTokens;
      tally.tokensOut += turn.usage.outputTokens;
      tally.costCents += turnCostCents(budget.price, turn.usage);
      tally.largestInputTokens = Math.max(
        tally.largestInputTokens,
        turn.usage.inputTokens,
      );
      transcript.push({
        role: "assistant",
        content: turn.text,
        ...(turn.toolCalls.length ? { toolCalls: turn.toolCalls } : {}),
      });
      await record(worker, claim.runId, {
        kind: "message",
        output: { text: turn.text ?? "", toolCalls: turn.toolCalls.length },
      });

      if (turn.toolCalls.length === 0) {
        await finish(worker, claim.runId, tally, {
          outcome: "done",
          result: { summary: turn.text ?? "", model: turn.model },
        });
        return;
      }

      let parked = false;
      for (const call of turn.toolCalls) {
        await record(worker, claim.runId, {
          kind: "tool_call",
          serviceName: call.name,
          input: (call.arguments ?? {}) as Record<string, unknown>,
        });
        const result = await performToolCall(worker, claim.runId, call);
        parked = parked || result.parked;
        await record(worker, claim.runId, {
          kind: "tool_result",
          serviceName: call.name,
          output: { content: result.content.slice(0, 2_000) },
        });
        transcript.push({
          role: "tool",
          toolCallId: call.id,
          // Fenced like any other outside material (C4.09). A tool result is
          // business data, and business data is full of words customers
          // wrote: a review, a form answer, a contact note. None of it is an
          // instruction from the owner, so none of it is handed over as one.
          content: untrustedEnvelope(result.content, {
            label: "tool result",
            marker: fenceMarker,
          }).text,
        });
      }

      if (parked) {
        // The write gate moved the task to waiting_approval. The run itself
        // is complete: it produced the approval the owner will decide on.
        await finish(worker, claim.runId, tally, {
          outcome: "done",
          result: { parked: true, model: turn.model },
        });
        return;
      }
    }
  } catch (error) {
    // Includes the kill switch: a paused agent's next service call refuses,
    // and the run closes as a failure the board can show. If even closing is
    // refused, the lease reaper reclaims the task — never silently lost.
    const message =
      error instanceof ServiceError
        ? error.message
        : error instanceof Error
          ? error.message
          : "The managed run failed.";
    await finish(worker, claim.runId, tally, {
      outcome: "failed",
      failureReason: message.slice(0, 2_000),
    }).catch(() => undefined);
  }
}

/**
 * One scheduler tick: give every managed worker a chance to take work.
 * Bounded per tick so one busy instance cannot hold the job lease all day —
 * whatever queues now runs a minute later.
 */
export async function runManagedAgentWork(): Promise<{ runs: number; blocked: number }> {
  let runs = 0;
  let blocked = 0;
  for (const worker of await managedWorkers()) {
    // Checked before claiming rather than after: a worker that cannot spend
    // would otherwise burn its task's attempts on runs that never start, and
    // park real work as needs_attention for a reason that is really a
    // setting. The owner hears about it instead.
    const affordable = await resolveRunBudget({
      agentId: worker.agentId,
      budgetCents: worker.budgetCents,
      budgetPeriod: worker.budgetPeriod,
      taskId: "00000000-0000-0000-0000-000000000000",
      taskBudgetCents: null,
      model: worker.connection.model,
      priceOverride: priceOverride(worker),
    });
    if ("refusal" in affordable) {
      blocked += 1;
      await notifyCannotSpend(
        worker,
        affordable.refusal,
        budgetRefusalMessage(affordable.refusal, worker.agentName),
      ).catch(() => undefined);
      continue;
    }
    while (runs < RUNS_PER_TICK) {
      let claim: Claim | null;
      try {
        claim = await claimTask.call({}, worker.actor);
      } catch {
        // Budget exhausted or paused between the listing and the claim: this
        // worker is done for the tick, the rest still get their turn.
        break;
      }
      if (!claim) break;
      runs += 1;
      await executeManagedRun(worker, claim);
    }
  }
  return { runs, blocked };
}
