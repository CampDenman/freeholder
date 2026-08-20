// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Telling the owner about money before they find out from an invoice (C4.06).
//
// §40 lists alerts beside the cap for a reason: a budget that silently stops
// an agent is a worker that mysteriously went quiet. These fire once per
// threshold per period — the notification layer's own dedupe does the
// once-part, keyed on the period so the next month says it again.
import { periodSpend, crossedAlertThreshold, type BudgetRefusal } from "@/core/agents/budget";
import { fanOutEventNotification } from "@/core/notifications/service";

interface AlertWorker {
  agentId: string;
  agentName: string;
  budgetCents: number;
  budgetPeriod: "day" | "week" | "month";
}

/** A stable label for the current window, so alerts repeat per period. */
function periodKey(period: "day" | "week" | "month", now = new Date()): string {
  const iso = now.toISOString();
  if (period === "day") return iso.slice(0, 10);
  if (period === "month") return iso.slice(0, 7);
  const monday = new Date(now);
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  return `w${monday.toISOString().slice(0, 10)}`;
}

/**
 * Called after a run settles. Reads the ledger back rather than trusting the
 * caller's arithmetic: the number an owner is shown should be the number the
 * ledger holds.
 */
export async function notifyBudget(
  worker: AlertWorker,
  justSpentCents: number,
): Promise<void> {
  if (worker.budgetCents <= 0 || justSpentCents <= 0) return;
  const after = await periodSpend(worker.agentId, worker.budgetPeriod);
  const before = Math.max(0, after - justSpentCents);
  const crossed = crossedAlertThreshold(before, after, worker.budgetCents);
  if (!crossed) return;
  await fanOutEventNotification(
    crossed === "exhausted" ? "agent.budgetExhausted" : "agent.budgetWarning",
    {
      id: worker.agentId,
      name: worker.agentName,
      spentCents: after,
      budgetCents: worker.budgetCents,
      period: worker.budgetPeriod,
      periodKey: periodKey(worker.budgetPeriod),
    },
  );
}

/**
 * Called when a worker cannot start at all. Without this the owner's evidence
 * is a queued task and no runs, which reads as a platform fault rather than a
 * setting they can change.
 */
export async function notifyCannotSpend(
  worker: AlertWorker,
  refusal: BudgetRefusal,
  detail: string,
): Promise<void> {
  await fanOutEventNotification("agent.cannotSpend", {
    id: worker.agentId,
    name: worker.agentName,
    reason: refusal.kind,
    detail,
    periodKey: periodKey(worker.budgetPeriod),
  });
}
