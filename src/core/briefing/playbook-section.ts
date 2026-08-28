// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// "Report into my briefing" (MASTER.md §42, C4.17).
//
// §42 calls this the mechanism behind an owner adding more and more things
// they want their agents to do regularly and report on: they write a prompt,
// pick a schedule, and tick a box. What comes back appears as its own section.
//
// The section reports what the work *said*. It does not act, and it does not
// paraphrase: a summary that quietly rewrote an agent's answer would be a
// third thing, trusted like the second and true like neither.
import { z } from "zod";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { agentPlaybooks, agentRuns, agentTasks } from "@/core/agents/schema";
import { zonedInstant } from "@/core/i18n/zoned";
import { defineService, ServiceError } from "@/core/service";
import { briefingContribution } from "@/core/briefing/registry";

/** How much of an agent's answer belongs in a summary before it stops being one. */
const MAX_BODY = 1_200;

export const playbookSection = defineService({
  name: "briefing.playbookSection",
  summary: "What one playbook's work found since yesterday.",
  kind: "query",
  permission: "system",
  input: z.object({
    userId: z.uuid(),
    onDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    timezone: z.string().min(1).max(80),
    playbookId: z.uuid(),
  }),
  output: briefingContribution,
  handler: async (input, ctx) => {
    const [playbook] = await ctx.tx
      .select({
        id: agentPlaybooks.id,
        name: agentPlaybooks.name,
        reportsToBriefing: agentPlaybooks.reportsToBriefing,
      })
      .from(agentPlaybooks)
      .where(eq(agentPlaybooks.id, input.playbookId))
      .limit(1);
    if (!playbook) throw new ServiceError("not_found", "No such playbook.");
    if (!playbook.reportsToBriefing) return null;

    const [year, month, day] = input.onDate.split("-").map(Number) as [
      number,
      number,
      number,
    ];
    // Since yesterday morning, so a Monday briefing still carries what the
    // weekend's runs found.
    const since = zonedInstant(input.timezone, { year, month, day: day - 1 });

    const [task] = await ctx.tx
      .select({
        id: agentTasks.id,
        status: agentTasks.status,
        result: agentTasks.result,
        failureReason: agentTasks.failureReason,
        updatedAt: agentTasks.updatedAt,
      })
      .from(agentTasks)
      .where(
        and(
          sql`${agentTasks.sourceRef} like ${`playbook:${playbook.id}@%`}`,
          gte(agentTasks.updatedAt, since),
          sql`${agentTasks.status} in ('done', 'failed', 'needs_attention')`,
        ),
      )
      .orderBy(desc(agentTasks.updatedAt))
      .limit(1);
    // Nothing has run since yesterday. Not an error, and not a section:
    // "no news" is what a schedule that has not come round yet looks like.
    if (!task) return null;

    const [run] = await ctx.tx
      .select({ id: agentRuns.id })
      .from(agentRuns)
      .where(eq(agentRuns.taskId, task.id))
      .orderBy(desc(agentRuns.startedAt))
      .limit(1);

    if (task.status !== "done") {
      // A playbook the owner asked to report is one whose silence they would
      // read as "nothing to report", so a failed run has to say so itself.
      return {
        title: playbook.name,
        severity: "attention" as const,
        body: task.failureReason
          ? `This did not finish: ${task.failureReason}`
          : "This did not finish.",
        items: [{ label: "Open the run", href: `/admin/work/tasks/${task.id}` }],
        playbookRunId: run?.id,
      };
    }

    const summary = readSummary(task.result);
    if (!summary) return null;
    return {
      title: playbook.name,
      severity: "changed" as const,
      body: summary,
      items: [{ label: "Open the run", href: `/admin/work/tasks/${task.id}` }],
      playbookRunId: run?.id,
    };
  },
});

/**
 * The agent's own words, and only if it left some.
 *
 * A result is whatever shape the work produced, so this reads the two places a
 * sentence could honestly be and gives up otherwise rather than rendering an
 * object at somebody first thing in the morning.
 */
function readSummary(result: unknown): string | null {
  if (typeof result === "string") return trimmed(result);
  if (!result || typeof result !== "object" || Array.isArray(result)) return null;
  const record = result as Record<string, unknown>;
  for (const key of ["summary", "briefing", "report", "text"]) {
    const value = record[key];
    if (typeof value === "string") return trimmed(value);
  }
  return null;
}

function trimmed(value: string): string | null {
  const text = value.trim();
  if (!text) return null;
  return text.length > MAX_BODY ? `${text.slice(0, MAX_BODY - 1)}…` : text;
}

export default [playbookSection];
