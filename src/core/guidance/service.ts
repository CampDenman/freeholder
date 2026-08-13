// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Resumable, permission-derived guidance. The UI receives only eligible flows
// and eligible steps; absent controls are the authorization boundary, not a
// disabled-looking promise. Progress is reconciled from durable outcomes.
import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
} from "drizzle-orm";
import { z } from "zod";
import { contacts } from "@/core/contacts/schema";
import { auditLog } from "@/core/events/schema";
import {
  guidanceFlowDefinitionSchema,
  type GuidanceFlowDefinition,
  type GuidanceOutcome,
  type GuidanceStepDefinition,
} from "@/core/guidance/definitions";
import { guidanceFlows, guidanceProgress } from "@/core/guidance/schema";
import {
  defineService,
  hasModuleAccess,
  ServiceError,
  type Actor,
  type GrantAccess,
  type Tx,
} from "@/core/service";
import { formSubmissions } from "@/modules/forms/schema";

export type GuidanceState = "not_started" | "active" | "dismissed" | "completed";

export interface GuidanceStepView extends GuidanceStepDefinition {
  completed: boolean;
}

export interface GuidanceFlowView {
  key: string;
  version: number;
  titleKey: string;
  descriptionKey: string;
  audienceRoles: string[];
  requiredCapabilities: string[];
  audienceMatch: boolean;
  state: GuidanceState;
  completedCount: number;
  totalCount: number;
  startedAt: Date | null;
  completedAt: Date | null;
  steps: GuidanceStepView[];
}

export interface GuidanceContextView {
  key: string;
  titleKey: string;
  audienceMatch: boolean;
  hrefs: string[];
}

function capabilityParts(capability: string): [string, GrantAccess] {
  const split = capability.lastIndexOf(":");
  return [
    capability.slice(0, split),
    capability.slice(split + 1) as GrantAccess,
  ];
}

export function actorHasGuidanceCapability(
  actor: Actor,
  capability: string,
): boolean {
  const [module, access] = capabilityParts(capability);
  return hasModuleAccess(actor, module, access);
}

function hasEveryCapability(actor: Actor, capabilities: readonly string[]): boolean {
  return capabilities.every((capability) =>
    actorHasGuidanceCapability(actor, capability),
  );
}

/**
 * Roles choose the recommended curriculum, never authority. A capability-
 * scoped flow is also useful to a custom role with the same grants; a flow
 * with no capability prerequisite (the customer portal) remains role-scoped.
 */
export function isGuidanceFlowEligible(
  actor: Actor,
  flow: GuidanceFlowDefinition,
): boolean {
  if (actor.kind !== "user" || flow.status !== "active") return false;
  const audienceMatch = flow.audienceRoles.includes(actor.role);
  if (flow.requiredCapabilities.length === 0 && !audienceMatch) return false;
  return hasEveryCapability(actor, flow.requiredCapabilities);
}

export function eligibleGuidanceSteps(
  actor: Actor,
  flow: GuidanceFlowDefinition,
): GuidanceStepDefinition[] {
  if (!isGuidanceFlowEligible(actor, flow)) return [];
  return flow.steps.filter((step) =>
    hasEveryCapability(actor, step.requiredCapabilities),
  );
}

function parseFlow(row: typeof guidanceFlows.$inferSelect): GuidanceFlowDefinition {
  return guidanceFlowDefinitionSchema.parse({
    key: row.key,
    version: row.version,
    titleKey: row.titleKey,
    descriptionKey: row.descriptionKey,
    audienceRoles: row.audienceRoles,
    requiredCapabilities: row.requiredCapabilities,
    steps: row.steps,
    status: row.status,
  });
}

async function latestActiveFlows(tx: Tx): Promise<GuidanceFlowDefinition[]> {
  const rows = await tx
    .select()
    .from(guidanceFlows)
    .where(eq(guidanceFlows.status, "active"))
    .orderBy(asc(guidanceFlows.key), desc(guidanceFlows.version));
  const latest = new Map<string, GuidanceFlowDefinition>();
  for (const row of rows) {
    if (!latest.has(row.key)) latest.set(row.key, parseFlow(row));
  }
  return [...latest.values()];
}

async function eligibleFlows(
  tx: Tx,
  actor: Extract<Actor, { kind: "user" }>,
  flowKey?: string,
): Promise<Array<{ definition: GuidanceFlowDefinition; steps: GuidanceStepDefinition[] }>> {
  const flows = (await latestActiveFlows(tx))
    .filter((flow) => (!flowKey || flow.key === flowKey) && isGuidanceFlowEligible(actor, flow))
    .map((definition) => ({
      definition,
      steps: eligibleGuidanceSteps(actor, definition),
    }))
    .filter((flow) => flow.steps.length > 0);
  return flows.sort((left, right) => {
    const leftMatch = left.definition.audienceRoles.includes(actor.role) ? 0 : 1;
    const rightMatch = right.definition.audienceRoles.includes(actor.role) ? 0 : 1;
    return leftMatch - rightMatch || left.definition.key.localeCompare(right.definition.key);
  });
}

async function outcomeReached(
  tx: Tx,
  actor: Extract<Actor, { kind: "user" }>,
  outcome: GuidanceOutcome,
  since: Date,
): Promise<boolean> {
  if (outcome.type === "audit") {
    const [row] = await tx
      .select({ id: auditLog.id })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.actor, `user:${actor.userId}`),
          inArray(auditLog.action, outcome.actions),
          gte(auditLog.at, since),
        ),
      )
      .limit(1);
    return Boolean(row);
  }
  if (outcome.type === "form-submission") {
    const [row] = await tx
      .select({ id: formSubmissions.id })
      .from(formSubmissions)
      .where(gte(formSubmissions.createdAt, since))
      .limit(1);
    return Boolean(row);
  }
  const [row] = await tx
    .select({ id: contacts.id })
    .from(contacts)
    .where(eq(contacts.userId, actor.userId))
    .limit(1);
  return Boolean(row);
}

function sameSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const expected = new Set(left);
  return right.every((item) => expected.has(item));
}

async function guidanceViews(
  tx: Tx,
  actor: Extract<Actor, { kind: "user" }>,
  flowKey?: string,
): Promise<GuidanceFlowView[]> {
  const flows = await eligibleFlows(tx, actor, flowKey);
  if (flows.length === 0) return [];
  const rows = await tx
    .select()
    .from(guidanceProgress)
    .where(eq(guidanceProgress.userId, actor.userId));
  const progressByFlow = new Map(
    rows.map((row) => [`${row.flowKey}@${row.flowVersion}`, row]),
  );

  const views: GuidanceFlowView[] = [];
  for (const { definition, steps } of flows) {
    const progress = progressByFlow.get(`${definition.key}@${definition.version}`);
    if (!progress) {
      views.push({
        key: definition.key,
        version: definition.version,
        titleKey: definition.titleKey,
        descriptionKey: definition.descriptionKey,
        audienceRoles: definition.audienceRoles,
        requiredCapabilities: definition.requiredCapabilities,
        audienceMatch: definition.audienceRoles.includes(actor.role),
        state: "not_started",
        completedCount: 0,
        totalCount: steps.length,
        startedAt: null,
        completedAt: null,
        steps: steps.map((step) => ({ ...step, completed: false })),
      });
      continue;
    }

    const visibleKeys = steps.map((step) => step.key);
    const completed = new Set(
      progress.completedSteps.filter((key) => visibleKeys.includes(key)),
    );
    const checks = await Promise.all(
      steps.map((step) => outcomeReached(tx, actor, step.outcome, progress.startedAt)),
    );
    checks.forEach((reached, index) => {
      if (reached) completed.add(steps[index]!.key);
    });
    const completedSteps = visibleKeys.filter((key) => completed.has(key));
    const gainedStep = visibleKeys.some((key) => !progress.seenSteps.includes(key));
    let state = progress.state;
    let completedAt = progress.completedAt;
    let dismissedAt = progress.dismissedAt;
    if (gainedStep && state !== "active") {
      state = "active";
      completedAt = null;
      dismissedAt = null;
    }
    if (state === "completed" && completedSteps.length < visibleKeys.length) {
      state = "active";
      completedAt = null;
    }
    if (state === "active" && completedSteps.length === visibleKeys.length) {
      state = "completed";
      completedAt ??= new Date();
    }

    const seenSteps = [...new Set([...progress.seenSteps, ...visibleKeys])];
    if (
      state !== progress.state ||
      completedAt?.getTime() !== progress.completedAt?.getTime() ||
      dismissedAt?.getTime() !== progress.dismissedAt?.getTime() ||
      !sameSet(completedSteps, progress.completedSteps) ||
      !sameSet(seenSteps, progress.seenSteps)
    ) {
      // Reconciliation writes only evidence derived from real product state.
      // It deliberately emits no fake "step completed" audit event.
      await tx
        .update(guidanceProgress)
        .set({
          completedSteps,
          seenSteps,
          state,
          completedAt,
          dismissedAt,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(guidanceProgress.userId, actor.userId),
            eq(guidanceProgress.flowKey, definition.key),
            eq(guidanceProgress.flowVersion, definition.version),
          ),
        );
    }

    views.push({
      key: definition.key,
      version: definition.version,
      titleKey: definition.titleKey,
      descriptionKey: definition.descriptionKey,
      audienceRoles: definition.audienceRoles,
      requiredCapabilities: definition.requiredCapabilities,
      audienceMatch: definition.audienceRoles.includes(actor.role),
      state,
      completedCount: completedSteps.length,
      totalCount: visibleKeys.length,
      startedAt: progress.startedAt,
      completedAt,
      steps: steps.map((step) => ({
        ...step,
        completed: completed.has(step.key),
      })),
    });
  }
  return views;
}

function requireUser(actor: Actor): Extract<Actor, { kind: "user" }> {
  if (actor.kind !== "user") {
    throw new ServiceError("permission", "Guidance belongs to a signed-in person.");
  }
  return actor;
}

const flowInput = z.object({
  flowKey: z.string().regex(/^[a-z][a-z0-9.-]*$/).max(120),
});

async function requiredFlow(
  tx: Tx,
  actor: Extract<Actor, { kind: "user" }>,
  flowKey: string,
) {
  const [flow] = await eligibleFlows(tx, actor, flowKey);
  if (!flow) {
    throw new ServiceError(
      "permission",
      "That guide is not available to your current role and capabilities.",
    );
  }
  return flow;
}

export const listGuidance = defineService({
  name: "guidance.list",
  summary: "List the signed-in person's eligible guidance and reconciled progress.",
  kind: "query",
  permission: "authenticated",
  input: z.object({ flowKey: flowInput.shape.flowKey.optional() }),
  handler: (_input, ctx) =>
    guidanceViews(ctx.tx, requireUser(ctx.actor), _input.flowKey),
});

export const listGuidanceContexts = defineService({
  name: "guidance.contexts",
  summary: "List capability-safe contextual guidance targets without opening progress.",
  kind: "query",
  permission: "authenticated",
  input: z.object({}),
  handler: async (_input, ctx): Promise<GuidanceContextView[]> => {
    const actor = requireUser(ctx.actor);
    return (await eligibleFlows(ctx.tx, actor)).map(({ definition, steps }) => ({
      key: definition.key,
      titleKey: definition.titleKey,
      audienceMatch: definition.audienceRoles.includes(actor.role),
      hrefs: steps.map((step) => step.href),
    }));
  },
});

export const startGuidance = defineService({
  name: "guidance.start",
  summary: "Start or resume one eligible guidance flow.",
  kind: "mutation",
  permission: "authenticated",
  input: flowInput,
  handler: async (input, ctx) => {
    const actor = requireUser(ctx.actor);
    const flow = await requiredFlow(ctx.tx, actor, input.flowKey);
    const visibleKeys = flow.steps.map((step) => step.key);
    await ctx.tx
      .insert(guidanceProgress)
      .values({
        userId: actor.userId,
        flowKey: flow.definition.key,
        flowVersion: flow.definition.version,
        seenSteps: visibleKeys,
      })
      .onConflictDoUpdate({
        target: [
          guidanceProgress.userId,
          guidanceProgress.flowKey,
          guidanceProgress.flowVersion,
        ],
        set: {
          seenSteps: visibleKeys,
          state: "active",
          completedAt: null,
          dismissedAt: null,
          updatedAt: new Date(),
        },
      });
    ctx.setSubject("guidance_flow", `${flow.definition.key}@${flow.definition.version}`);
    return { key: flow.definition.key, version: flow.definition.version, state: "active" as const };
  },
});

export const dismissGuidance = defineService({
  name: "guidance.dismiss",
  summary: "Skip one eligible guidance flow for now.",
  kind: "mutation",
  permission: "authenticated",
  input: flowInput,
  handler: async (input, ctx) => {
    const actor = requireUser(ctx.actor);
    const flow = await requiredFlow(ctx.tx, actor, input.flowKey);
    const now = new Date();
    await ctx.tx
      .insert(guidanceProgress)
      .values({
        userId: actor.userId,
        flowKey: flow.definition.key,
        flowVersion: flow.definition.version,
        seenSteps: flow.steps.map((step) => step.key),
        state: "dismissed",
        dismissedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          guidanceProgress.userId,
          guidanceProgress.flowKey,
          guidanceProgress.flowVersion,
        ],
        set: {
          seenSteps: flow.steps.map((step) => step.key),
          state: "dismissed",
          completedAt: null,
          dismissedAt: now,
          updatedAt: now,
        },
      });
    ctx.setSubject("guidance_flow", `${flow.definition.key}@${flow.definition.version}`);
    return { key: flow.definition.key, version: flow.definition.version, state: "dismissed" as const };
  },
});

export const resetGuidance = defineService({
  name: "guidance.reset",
  summary: "Restart one eligible guidance flow from current product state.",
  kind: "mutation",
  permission: "authenticated",
  input: flowInput,
  handler: async (input, ctx) => {
    const actor = requireUser(ctx.actor);
    const flow = await requiredFlow(ctx.tx, actor, input.flowKey);
    const now = new Date();
    const seenSteps = flow.steps.map((step) => step.key);
    await ctx.tx
      .insert(guidanceProgress)
      .values({
        userId: actor.userId,
        flowKey: flow.definition.key,
        flowVersion: flow.definition.version,
        seenSteps,
        startedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          guidanceProgress.userId,
          guidanceProgress.flowKey,
          guidanceProgress.flowVersion,
        ],
        set: {
          completedSteps: [],
          seenSteps,
          state: "active",
          startedAt: now,
          completedAt: null,
          dismissedAt: null,
          updatedAt: now,
        },
      });
    ctx.setSubject("guidance_flow", `${flow.definition.key}@${flow.definition.version}`);
    return { key: flow.definition.key, version: flow.definition.version, state: "active" as const };
  },
});

export default [
  listGuidance,
  listGuidanceContexts,
  startGuidance,
  dismissGuidance,
  resetGuidance,
];
