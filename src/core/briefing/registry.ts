// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Who gets to put a section in the briefing (MASTER.md §42, C4.15).
//
// Sections come from contributors, not from a hardcoded list. That is the
// whole design: a briefing gains a section when a module is enabled, and no
// screen changes. It is the same seam §5 gives sitemaps — a manifest names
// what it contributes, and core asks whatever is registered.
//
// A contributor is an ordinary service. That is not incidental: it means a
// contribution is validated against a contract, runs inside the assembling
// transaction, is visible in the audit trail, and cannot reach anything its
// caller could not. A module cannot smuggle a section in by writing rows.
import { z } from "zod";

export const briefingItem = z.object({
  label: z.string().min(1).max(300),
  /** Where the thing is, if it is somewhere. Internal paths only. */
  href: z.string().max(500).optional(),
  detail: z.string().max(300).optional(),
});

/**
 * What a contributor returns.
 *
 * `null` means "nothing to say today", which is different from an empty
 * section: §42 omits empty sections entirely, because a briefing that lists
 * everything is a briefing nobody finishes.
 */
export const briefingContribution = z
  .object({
    title: z.string().min(1).max(200),
    body: z.string().max(4_000).optional(),
    items: z.array(briefingItem).max(50).default([]),
    severity: z.enum(["attention", "today", "changed"]).default("changed"),
    /** Set by a playbook section, so the run behind it stays reachable. */
    playbookRunId: z.uuid().optional(),
  })
  .nullable();

export type BriefingContribution = z.infer<typeof briefingContribution>;

/** What every contributor is asked. */
export const briefingRequest = z.object({
  /** Whose briefing this is; a contributor may answer differently per person. */
  userId: z.uuid(),
  /** The business's calendar date, as `YYYY-MM-DD`. */
  onDate: z.string(),
  /** The business's timezone, so "today" means the same thing to everyone. */
  timezone: z.string(),
});

export interface RegisteredContributor {
  /** Stable, and what a preference switches off. Namespaced like a service. */
  key: string;
  /** The service that produces the section. */
  service: string;
  source: "core" | "module" | "playbook";
  /** Ties within a severity, so a briefing reads the same way every day. */
  position: number;
  /**
   * Extra input for contributors that are registered more than once.
   *
   * One playbook is one section, so the same service answers for each of them
   * and needs to be told which (C4.17). Core and module contributors are
   * registered once and carry nothing here.
   */
  params?: Record<string, string>;
}

/**
 * Core's own contributors (C4.16), in the order they break ties.
 *
 * Severity decides the reading order; these positions only settle sections
 * that share one. Core sits above modules because "a connection stopped
 * working" outranks anything a module has to report — the platform being
 * unhappy is the reason §42 says the briefing is worth opening on a quiet day.
 */
const coreContributors: RegisteredContributor[] = [
  { key: "briefing.appointments", service: "briefing.appointments", source: "core", position: 10 },
  { key: "briefing.agentAttention", service: "briefing.agentAttention", source: "core", position: 20 },
  { key: "briefing.reconnects", service: "briefing.reconnects", source: "core", position: 21 },
  { key: "briefing.webhookFailures", service: "briefing.webhookFailures", source: "core", position: 22 },
  { key: "briefing.update", service: "briefing.update", source: "core", position: 30 },
];

/**
 * Everything that may contribute, in the order a briefing lays them out.
 *
 * Module contributors are read from the manifests that are actually enabled,
 * so a section arriving and leaving follows the module rather than a second
 * list somebody has to remember to edit.
 */
export async function briefingContributors(): Promise<RegisteredContributor[]> {
  const found = [...coreContributors];
  const { default: manifests } = await import("@/modules");
  for (const manifest of manifests) {
    (manifest.briefing?.contributors ?? []).forEach((service, index) => {
      found.push({ key: service, service, source: "module", position: 100 + index });
    });
  }
  found.push(...(await playbookContributors()));
  return found.sort((a, b) => a.position - b.position);
}

/**
 * One section per playbook that was told to report into the briefing.
 *
 * Read at assembly rather than declared anywhere, because playbooks are
 * written at runtime — the same reason their schedules live in a column
 * (C4.14). A key of `playbook:<id>` is what lets an owner hide one playbook's
 * section without touching the others or the work behind it.
 */
async function playbookContributors(): Promise<RegisteredContributor[]> {
  try {
    const { db } = await import("@/core/db");
    const { and, asc, eq } = await import("drizzle-orm");
    const { agentPlaybooks } = await import("@/core/agents/schema");
    const reporting = await db()
      .select({ id: agentPlaybooks.id })
      .from(agentPlaybooks)
      .where(
        and(
          eq(agentPlaybooks.reportsToBriefing, true),
          eq(agentPlaybooks.enabled, true),
        ),
      )
      .orderBy(asc(agentPlaybooks.name))
      .limit(30);
    return reporting.map((playbook, index) => ({
      key: `playbook:${playbook.id}`,
      service: "briefing.playbookSection",
      source: "playbook" as const,
      // Below core and the modules: what an owner asked an agent to look into
      // is rarely more urgent than the platform saying it is broken.
      position: 200 + index,
      params: { playbookId: playbook.id },
    }));
  } catch {
    // No agents table yet, or a database that cannot be read: the rest of the
    // briefing is still worth having.
    return [];
  }
}

/** Highest first: what needs the person, then today, then what changed. */
export const SEVERITY_ORDER: Record<string, number> = {
  attention: 0,
  today: 1,
  changed: 2,
};
