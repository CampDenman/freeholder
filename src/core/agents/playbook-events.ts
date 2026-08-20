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
 */
export async function startEventPlaybooks(
  eventName: string,
  payload: unknown,
): Promise<void> {
  // Its own events would otherwise start playbooks that start events.
  if (eventName.startsWith("agentPlaybook.") || eventName.startsWith("agentTask.")) {
    return;
  }
  const record =
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : {};
  await startPlaybooksForEvent
    .call({ eventName, payload: record }, { kind: "system" })
    .catch(() => undefined);
}
