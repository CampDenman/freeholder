// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Money, capped before it is spent (C4.06, MASTER.md §40).
//
// §40 is specific about the direction: "a budget in cents checked *before*
// each step rather than tallied afterwards". A tally tells an owner what they
// already owe; a check is what keeps the number under the cap they set. So
// every entry point here answers one question — may this run spend this much
// right now — and the answer is fail-closed: no price, no spending.
//
// Three scopes nest, and the tightest one wins:
//   period  the agent's budget_cents per day/week/month (the owner's cap)
//   task    an optional budget_cents on one task (a ceiling for this work)
//   run     what is left of both, once this run's own spend is counted
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/core/db";
import { agentTasks } from "@/core/agents/schema";
import { runSpend, runs } from "@/core/runs/schema";
import { modelPrice, type ModelPrice } from "@/core/agents/pricing";

export interface BudgetScope {
  /** Cap in cents. Zero means this agent may not spend at all. */
  budgetCents: number;
  budgetPeriod: "day" | "week" | "month";
  spentCents: number;
  remainingCents: number;
}

export interface RunBudget {
  price: ModelPrice;
  /** What this run may still spend, after period and task caps. */
  remainingCents: number;
  period: BudgetScope;
  taskRemainingCents: number | null;
}

/** What one agent has spent in the current window. */
export async function periodSpend(
  agentId: string,
  period: "day" | "week" | "month",
): Promise<number> {
  const [row] = await db()
    .select({ total: sql<number>`coalesce(sum(${runSpend.costCents}), 0)::int` })
    .from(runSpend)
    .where(
      and(
        eq(runSpend.agentId, agentId),
        sql`${runSpend.periodStart} >= date_trunc(${period}, now())`,
      ),
    );
  return row?.total ?? 0;
}

/** What every run of one task has cost so far, across attempts. */
export async function taskSpend(taskId: string): Promise<number> {
  const [row] = await db()
    .select({ total: sql<number>`coalesce(sum(${runs.costCents}), 0)::int` })
    .from(runs)
    .where(eq(runs.subjectId, taskId));
  return row?.total ?? 0;
}

export type BudgetRefusal =
  | { kind: "no_budget" }
  | { kind: "unpriced"; model: string | null }
  | { kind: "period_exhausted"; scope: BudgetScope }
  | { kind: "task_exhausted"; remainingCents: number };

/** Plain English for an owner, from the machine reason. */
export function budgetRefusalMessage(
  refusal: BudgetRefusal,
  agentName: string,
): string {
  switch (refusal.kind) {
    case "no_budget":
      return `${agentName} has no budget, so it cannot run managed work. Set one in Settings — a managed run always costs money.`;
    case "unpriced":
      return `${agentName} cannot run: the platform does not know what ${refusal.model ?? "this model"} costs. Set the price on its connection, or choose a model with a published price.`;
    case "period_exhausted":
      return `${agentName} has spent its ${refusal.scope.budgetPeriod}ly budget (${refusal.scope.spentCents} of ${refusal.scope.budgetCents} cents). Raise it in Settings, or wait for the next period.`;
    case "task_exhausted":
      return `This task has used its own budget. Raise the task's budget to continue.`;
  }
}

/**
 * Everything a run needs to know about money, resolved once at its start.
 *
 * Returning a refusal rather than throwing is deliberate: the caller decides
 * whether an unaffordable run is a skipped claim (nothing happened yet) or a
 * stopped run (something did), and those are different rows in an owner's
 * board.
 */
export async function resolveRunBudget(input: {
  agentId: string;
  budgetCents: number;
  budgetPeriod: "day" | "week" | "month";
  taskId: string;
  taskBudgetCents: number | null;
  model: string | null;
  priceOverride?: Partial<ModelPrice>;
}): Promise<{ budget: RunBudget } | { refusal: BudgetRefusal }> {
  if (input.budgetCents <= 0) return { refusal: { kind: "no_budget" } };
  const price = modelPrice(input.model, input.priceOverride ?? {});
  if (!price) return { refusal: { kind: "unpriced", model: input.model } };

  const spent = await periodSpend(input.agentId, input.budgetPeriod);
  const period: BudgetScope = {
    budgetCents: input.budgetCents,
    budgetPeriod: input.budgetPeriod,
    spentCents: spent,
    remainingCents: Math.max(0, input.budgetCents - spent),
  };
  if (period.remainingCents <= 0) {
    return { refusal: { kind: "period_exhausted", scope: period } };
  }

  let taskRemaining: number | null = null;
  if (input.taskBudgetCents !== null && input.taskBudgetCents > 0) {
    taskRemaining = Math.max(0, input.taskBudgetCents - (await taskSpend(input.taskId)));
    if (taskRemaining <= 0) {
      return { refusal: { kind: "task_exhausted", remainingCents: 0 } };
    }
  }

  return {
    budget: {
      price,
      remainingCents:
        taskRemaining === null
          ? period.remainingCents
          : Math.min(period.remainingCents, taskRemaining),
      period,
      taskRemainingCents: taskRemaining,
    },
  };
}

/** The thresholds an owner is told about, once each per period. */
export const BUDGET_ALERT_THRESHOLD = 0.8;

export function crossedAlertThreshold(
  before: number,
  after: number,
  budgetCents: number,
): "warning" | "exhausted" | null {
  if (budgetCents <= 0) return null;
  if (before < budgetCents && after >= budgetCents) return "exhausted";
  const line = Math.floor(budgetCents * BUDGET_ALERT_THRESHOLD);
  if (before < line && after >= line) return "warning";
  return null;
}

/** Tasks whose remaining task-budget a caller can enforce mid-run. */
export async function taskBudgetCents(taskId: string): Promise<number | null> {
  const [row] = await db()
    .select({ budgetCents: agentTasks.budgetCents })
    .from(agentTasks)
    .where(eq(agentTasks.id, taskId))
    .limit(1);
  return row?.budgetCents ?? null;
}
