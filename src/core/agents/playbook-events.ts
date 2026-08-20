// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Event-triggered playbooks (C4.08): the bus side of the trigger.
//
// A thin service wrapper rather than raw database work, because starting work
// has to happen in one transaction with an audit row against a named actor —
// and because the playbook's own rules (enabled, ceilings, untrusted framing)
// live in the service that owns them.
import { z } from "zod";
import { defineService } from "@/core/service";
import { runEventPlaybooks } from "@/core/agents/playbooks";

const startPlaybooksForEvent = defineService({
  name: "agents.startEventPlaybooks",
  summary: "Start any playbook waiting on this event.",
  kind: "mutation",
  // The bus is not a person and holds no key; this runs as system, and the
  // work it creates is marked untrusted because a payload is not an owner.
  permission: "public",
  mcpExclude: true,
  agentCallable: false,
  input: z.object({
    eventName: z.string().min(1).max(120),
    payload: z.record(z.string(), z.unknown()).default({}),
  }),
  output: z.object({ started: z.array(z.uuid()) }),
  handler: async (input, ctx) => ({
    started: await runEventPlaybooks(ctx, input.eventName, input.payload),
  }),
});

export default [startPlaybooksForEvent];

/**
 * Called for every committed event. Never throws into the bus: a playbook
 * that cannot start must not fail the mutation that emitted the event, and
 * the refusal is already in the audit trail.
 *
 * The cheap match happens *before* the service call, deliberately. Every
 * service call writes an audit row, and a listener that looked and found
 * nothing is not something that happened to the business — an audit trail
 * with one row per event per listener is one nobody can read.
 */
export async function startEventPlaybooks(
  eventName: string,
  payload: unknown,
): Promise<void> {
  // Its own events would otherwise start playbooks that start events.
  if (eventName.startsWith("agentPlaybook.") || eventName.startsWith("agentTask.")) {
    return;
  }
  try {
    const { db } = await import("@/core/db");
    const { and, eq, sql } = await import("drizzle-orm");
    const { agentPlaybooks } = await import("@/core/agents/schema");
    const family = `${eventName.split(".")[0]!}.*`;
    const [waiting] = await db()
      .select({ id: agentPlaybooks.id })
      .from(agentPlaybooks)
      .where(
        and(
          eq(agentPlaybooks.trigger, "event"),
          eq(agentPlaybooks.enabled, true),
          sql`${agentPlaybooks.eventPattern} in (${eventName}, ${family})`,
        ),
      )
      .limit(1);
    if (!waiting) return;

    const record =
      payload && typeof payload === "object" && !Array.isArray(payload)
        ? (payload as Record<string, unknown>)
        : {};
    await startPlaybooksForEvent.call({ eventName, payload: record }, { kind: "system" });
  } catch {
    // The mutation that emitted the event has already committed; a playbook
    // that could not start must not undo it.
  }
}
