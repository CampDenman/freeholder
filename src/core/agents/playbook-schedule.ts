// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Scheduled playbooks (C4.14, MASTER.md §40).
//
// pg-boss schedules are registered at boot; playbooks are written at runtime,
// and an owner typing "every Monday, check for stale quotes" at 3pm on a
// Tuesday cannot wait for a redeploy. So there is one scheduled job,
// `core.runPlaybooks`, and the work list is a query over `next_run_at`.
//
// Three rules make that safe, and each of them is a way schedulers usually go
// wrong:
//
//  - **A missed window runs once, not once per minute it was missed.**
//    `next_run_at` is advanced to the next occurrence *after now*, never
//    incremented by one interval in a loop. An instance down for six hours
//    comes back to one overdue daily briefing rather than three hundred and
//    sixty, which is how an outage turns into a self-inflicted outage.
//  - **Overlap is refused.** A playbook whose last task is still open does not
//    start another; the schedule advances and the owner is told what is still
//    running.
//  - **The clock is the business's.** Occurrences are computed in a named
//    zone, so "every weekday at 07:00" is 07:00 in March and in July.
import { z } from "zod";
import { and, eq, inArray, isNotNull, lte, sql } from "drizzle-orm";
import { db } from "@/core/db";
import { row, timestamp, uuid } from "@/core/contract";
import { agentPlaybooks, agentTasks } from "@/core/agents/schema";
import { startScheduledPlaybook } from "@/core/agents/playbooks";
import {
  assertSchedule,
  assertTimezone,
  nextOccurrence,
  scheduleZone,
} from "@/core/agents/cron";
import {
  defineService,
  ServiceError,
  type ServiceContext,
  type Tx,
} from "@/core/service";

/**
 * A task in one of these states is still somebody's problem.
 *
 * Everything except done, failed and cancelled — including the ones waiting on
 * a person. A daily playbook whose last run is sitting on an approval should
 * not quietly start a second one; the owner is told what is holding it, which
 * is the prompt to go and answer.
 */
const OPEN_TASK_STATES = [
  "queued",
  "running",
  "waiting_approval",
  "blocked",
  "needs_attention",
] as const;


export const setPlaybookSchedule = defineService({
  name: "agents.setPlaybookSchedule",
  summary: "Say when a playbook should run, and in which timezone.",
  kind: "mutation",
  permission: "scoped",
  agentCallable: false,
  writeClass: "write",
  input: z.object({
    id: z.uuid(),
    cron: z.string().min(1).max(120),
    timezone: z.string().min(1).max(80).optional(),
    /** Whether a window missed during an outage runs late or is skipped. */
    catchUp: z.boolean().default(false),
  }),
  output: row({
    id: uuid,
    scheduleCron: z.string(),
    timezone: z.string(),
    catchUp: z.boolean(),
    nextRunAt: timestamp.nullable(),
  }),
  handler: async (input, ctx) => {
    if (ctx.actor.kind === "agent") {
      throw new ServiceError(
        "permission",
        "An API key cannot schedule work. Sign in to schedule a playbook.",
      );
    }
    const [playbook] = await ctx.tx
      .select()
      .from(agentPlaybooks)
      .where(eq(agentPlaybooks.id, input.id))
      .limit(1);
    if (!playbook) throw new ServiceError("not_found", "No such playbook.");

    if (input.timezone) assertTimezone(input.timezone);
    const timezone = input.timezone ?? (await scheduleZone(playbook));
    assertSchedule(input.cron, timezone);

    const [updated] = await ctx.tx
      .update(agentPlaybooks)
      .set({
        trigger: "schedule",
        scheduleCron: input.cron,
        timezone: input.timezone ?? playbook.timezone,
        catchUp: input.catchUp,
        // From now, never from the old cursor: changing a schedule must not
        // make yesterday's missed window suddenly due.
        nextRunAt: nextOccurrence(input.cron, timezone, new Date()),
        updatedAt: sql`now()`,
      })
      .where(eq(agentPlaybooks.id, input.id))
      .returning();

    ctx.setSubject("agent_playbook", input.id);
    ctx.queueEvent("agentPlaybook.scheduled", {
      id: input.id,
      name: playbook.name,
      cron: input.cron,
      timezone,
    });
    return {
      id: updated!.id,
      scheduleCron: updated!.scheduleCron!,
      timezone,
      catchUp: updated!.catchUp,
      nextRunAt: updated!.nextRunAt,
      createdAt: updated!.createdAt,
      updatedAt: updated!.updatedAt,
    };
  },
});

export interface PlaybookTick {
  playbookId: string;
  name: string;
  outcome: "started" | "skipped" | "missed";
  taskId?: string;
  detail?: string;
  nextRunAt: Date | null;
}

/**
 * One playbook's turn: start it, or say why not, then move the schedule on.
 *
 * The advance happens in every branch, including the refusals. A schedule that
 * only moved when work started would retry a refused window every minute for
 * as long as the reason lasted.
 */
async function tick(
  ctx: ServiceContext,
  playbook: typeof agentPlaybooks.$inferSelect,
  now: Date,
): Promise<PlaybookTick> {
  const timezone = await scheduleZone(playbook);
  const due = playbook.nextRunAt ?? now;
  let outcome: PlaybookTick["outcome"] = "started";
  let detail: string | undefined;
  let taskId: string | undefined;

  const [open] = await ctx.tx
    .select({
      id: agentTasks.id,
      status: agentTasks.status,
      createdAt: agentTasks.createdAt,
    })
    .from(agentTasks)
    .where(
      and(
        sql`${agentTasks.sourceRef} like ${`playbook:${playbook.id}@%`}`,
        inArray(agentTasks.status, [...OPEN_TASK_STATES]),
      ),
    )
    .limit(1);

  // How late this window is, measured against the window rather than against
  // the previous run: a run that finished on time and a window nobody was
  // there for are different things.
  const lateByMinutes = Math.floor((now.getTime() - due.getTime()) / 60_000);
  const missedWindow = lateByMinutes >= 2;

  if (open) {
    outcome = "skipped";
    const since = new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
    }).format(open.createdAt);
    detail =
      open.status === "waiting_approval"
        ? `Waiting for approval since ${since}.`
        : open.status === "needs_attention"
          ? `Needs attention since ${since}.`
          : `Still running from ${since}.`;
  } else if (missedWindow && !playbook.catchUp) {
    // The window passed while nobody was listening, and this playbook said a
    // late run is worse than none — a 07:00 briefing delivered at 14:00 is not
    // a briefing.
    outcome = "missed";
    detail = `Missed by ${lateByMinutes} minute(s); catch-up is off.`;
  } else {
    const started = await startScheduledPlaybook(ctx, playbook);
    taskId = started.taskId;
    detail = missedWindow ? `Ran ${lateByMinutes} minute(s) late.` : undefined;
  }

  // Strictly after *now*, not after the window it missed. This one line is
  // what stops an instance that was down for six hours starting three hundred
  // and sixty daily briefings.
  const nextRunAt = playbook.scheduleCron
    ? nextOccurrence(playbook.scheduleCron, timezone, now)
    : null;

  await ctx.tx
    .update(agentPlaybooks)
    .set({
      nextRunAt,
      lastRunAt: outcome === "started" ? now : playbook.lastRunAt,
      lastOutcome: detail ?? "Ran on time.",
      updatedAt: sql`now()`,
    })
    .where(eq(agentPlaybooks.id, playbook.id));

  return { playbookId: playbook.id, name: playbook.name, outcome, taskId, detail, nextRunAt };
}

export const runDuePlaybooks = defineService({
  name: "agents.runDuePlaybooks",
  summary: "Start the scheduled playbooks whose time has come.",
  kind: "mutation",
  permission: "system",
  input: z.object({}),
  output: z.object({
    started: z.number().int(),
    skipped: z.number().int(),
    missed: z.number().int(),
  }),
  handler: async (_input, ctx) => {
    if (ctx.actor.kind !== "system") {
      throw new ServiceError(
        "permission",
        "The scheduler runs this. Use agents.runPlaybook to start one by hand.",
      );
    }
    const now = new Date();
    const due = await claimDue(ctx.tx, now);
    const ticks: PlaybookTick[] = [];
    for (const playbook of due) ticks.push(await tick(ctx, playbook, now));
    return {
      started: ticks.filter((t) => t.outcome === "started").length,
      skipped: ticks.filter((t) => t.outcome === "skipped").length,
      missed: ticks.filter((t) => t.outcome === "missed").length,
    };
  },
});

/**
 * Whatever is due, locked against the other replica doing the same thing.
 *
 * `skip locked` rather than a wait: a row another worker already has is a row
 * that is already being handled, and blocking on it would only make two
 * workers slow instead of one.
 */
async function claimDue(
  tx: Tx,
  now: Date,
): Promise<(typeof agentPlaybooks.$inferSelect)[]> {
  return tx
    .select()
    .from(agentPlaybooks)
    .where(
      and(
        eq(agentPlaybooks.enabled, true),
        eq(agentPlaybooks.trigger, "schedule"),
        isNotNull(agentPlaybooks.nextRunAt),
        lte(agentPlaybooks.nextRunAt, now),
      ),
    )
    .limit(50)
    .for("update", { skipLocked: true });
}

/** The job's entry point, outside any caller's transaction. */
export async function runScheduledPlaybooks(): Promise<{
  started: number;
  skipped: number;
  missed: number;
}> {
  const [pending] = await db()
    .select({ id: agentPlaybooks.id })
    .from(agentPlaybooks)
    .where(
      and(
        eq(agentPlaybooks.enabled, true),
        eq(agentPlaybooks.trigger, "schedule"),
        isNotNull(agentPlaybooks.nextRunAt),
        lte(agentPlaybooks.nextRunAt, new Date()),
      ),
    )
    .limit(1);
  // Nothing due is the common case, and it must not cost an audit row a
  // minute for the life of the instance.
  if (!pending) return { started: 0, skipped: 0, missed: 0 };
  return runDuePlaybooks.call({}, { kind: "system" });
}

export default [setPlaybookSchedule, runDuePlaybooks];
