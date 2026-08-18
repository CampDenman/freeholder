// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Transactional deterministic demo orchestration.
import { and, asc, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { listed, row, timestamp, uuid } from "@/core/contract";
import {
  demoHandlerInputSchema,
  demoLoadResultSchema,
  demoPurgeResultSchema,
  demoVerifyResultSchema,
  type DemoFixtureContribution,
  type DemoRecordReference,
  type DemoScenarioDefinition,
} from "@/core/onboarding/contract";
import {
  demoFixture,
  demoScenario,
  demoScenarios as registeredDemoScenarios,
  onboardingGuidance,
} from "@/core/onboarding/registry";
import { guidanceFlows } from "@/core/guidance/schema";
import { actorHasGuidanceCapability } from "@/core/guidance/service";
import {
  defineService,
  getService,
  ServiceError,
  type Actor,
  type Service,
  type ServiceContext,
  type Tx,
} from "@/core/service";
import { demoRecords, demoScenarioRuns, demoScenarios } from "./schema";

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function fixtureManifest(definition: DemoScenarioDefinition) {
  return definition.fixtureContributions.map((reference) => {
    const fixture = demoFixture(reference.key, reference.version);
    if (!fixture) {
      throw new Error(
        `registered scenario names missing fixture ${reference.key}@${reference.version}`,
      );
    }
    return fixture;
  });
}

/**
 * Persist registered immutable definitions. A reused key/version must be byte-
 * equivalent in meaning; changing it requires a new version.
 */
export async function syncOnboardingDefinitions(tx: Tx): Promise<void> {
  const guidance = onboardingGuidance();
  if (guidance.length) {
    await tx
      .insert(guidanceFlows)
      .values(
        guidance.map((flow) => ({
          key: flow.key,
          version: flow.version,
          titleKey: flow.titleKey,
          descriptionKey: flow.descriptionKey,
          audienceRoles: flow.audienceRoles,
          requiredCapabilities: flow.requiredCapabilities,
          steps: flow.steps,
          status: flow.status,
        })),
      )
      .onConflictDoNothing();
    for (const definition of guidance) {
      const [stored] = await tx
        .select()
        .from(guidanceFlows)
        .where(
          and(
            eq(guidanceFlows.key, definition.key),
            eq(guidanceFlows.version, definition.version),
          ),
        )
        .limit(1);
      const expected = {
        key: definition.key,
        version: definition.version,
        titleKey: definition.titleKey,
        descriptionKey: definition.descriptionKey,
        audienceRoles: definition.audienceRoles,
        requiredCapabilities: definition.requiredCapabilities,
        steps: definition.steps,
        status: definition.status,
      };
      if (
        !stored ||
        canonical(expected) !==
          canonical({
            key: stored.key,
            version: stored.version,
            titleKey: stored.titleKey,
            descriptionKey: stored.descriptionKey,
            audienceRoles: stored.audienceRoles,
            requiredCapabilities: stored.requiredCapabilities,
            steps: stored.steps,
            status: stored.status,
          })
      ) {
        throw new ServiceError(
          "conflict",
          `Guidance definition ${definition.key}@${definition.version} changed without a version increase.`,
        );
      }
    }
  }

  for (const definition of registeredDemoScenarios()) {
    const manifest = fixtureManifest(definition);
    await tx
      .insert(demoScenarios)
      .values({
        key: definition.key,
        version: definition.version,
        titleKey: definition.titleKey,
        descriptionKey: definition.descriptionKey,
        preset: definition.preset,
        requiredModules: definition.requiredModules,
        requiredCapabilities: definition.requiredCapabilities,
        fixtureManifest: manifest,
        defaultLocale: definition.defaultLocale,
        supportedLocales: definition.supportedLocales,
        tourFlowKey: definition.tourFlowKey,
        status: definition.status,
      })
      .onConflictDoNothing();

    const [stored] = await tx
      .select()
      .from(demoScenarios)
      .where(
        and(
          eq(demoScenarios.key, definition.key),
          eq(demoScenarios.version, definition.version),
        ),
      )
      .limit(1);
    const expected = {
      key: definition.key,
      version: definition.version,
      titleKey: definition.titleKey,
      descriptionKey: definition.descriptionKey,
      preset: definition.preset,
      requiredModules: definition.requiredModules,
      requiredCapabilities: definition.requiredCapabilities,
      fixtureManifest: manifest,
      defaultLocale: definition.defaultLocale,
      supportedLocales: definition.supportedLocales,
      tourFlowKey: definition.tourFlowKey ?? null,
      status: definition.status,
    };
    if (!stored || canonical(expected) !== canonical({
      key: stored.key,
      version: stored.version,
      titleKey: stored.titleKey,
      descriptionKey: stored.descriptionKey,
      preset: stored.preset,
      requiredModules: stored.requiredModules,
      requiredCapabilities: stored.requiredCapabilities,
      fixtureManifest: stored.fixtureManifest,
      defaultLocale: stored.defaultLocale,
      supportedLocales: stored.supportedLocales,
      tourFlowKey: stored.tourFlowKey,
      status: stored.status,
    })) {
      throw new ServiceError(
        "conflict",
        `Demo definition ${definition.key}@${definition.version} changed without a version increase.`,
      );
    }
  }
}

function requireCapabilities(actor: Actor, definition: DemoScenarioDefinition): void {
  if (
    !definition.requiredCapabilities.every((capability) =>
      actorHasGuidanceCapability(actor, capability),
    )
  ) {
    throw new ServiceError(
      "permission",
      "This scenario needs access your current role does not have.",
    );
  }
}

function latestScenario(key: string, version?: number): DemoScenarioDefinition {
  const definitions = registeredDemoScenarios()
    .filter(
      (candidate) =>
        candidate.key === key &&
        candidate.status === "active" &&
        (version === undefined || candidate.version === version),
    )
    .sort((left, right) => right.version - left.version);
  const definition = definitions[0];
  if (!definition) {
    throw new ServiceError("not_found", `No active demo scenario named ${key}.`);
  }
  return definition;
}

function orderedFixtures(definition: DemoScenarioDefinition): DemoFixtureContribution[] {
  const selected = new Map(
    definition.fixtureContributions.map((reference) => {
      const fixture = demoFixture(reference.key, reference.version);
      if (!fixture) {
        throw new Error(
          `scenario ${definition.key} names missing fixture ${reference.key}@${reference.version}`,
        );
      }
      return [reference.key, fixture] as const;
    }),
  );
  const result: DemoFixtureContribution[] = [];
  const visiting = new Set<string>();
  const done = new Set<string>();
  const visit = (key: string) => {
    if (done.has(key)) return;
    if (visiting.has(key)) throw new Error(`circular demo fixture dependency at ${key}`);
    visiting.add(key);
    const fixture = selected.get(key)!;
    for (const dependency of fixture.dependsOn) {
      const selectedDependency = selected.get(dependency.key);
      if (!selectedDependency || selectedDependency.version !== dependency.version) {
        throw new Error(
          `scenario ${definition.key} omits fixture dependency ${dependency.key}@${dependency.version}`,
        );
      }
      visit(dependency.key);
    }
    visiting.delete(key);
    done.add(key);
    result.push(fixture);
  };
  for (const reference of definition.fixtureContributions) visit(reference.key);
  return result;
}

function contributionService(name: string): Service<z.ZodType, unknown> {
  return getService(name);
}

function handlerInput(
  definition: DemoScenarioDefinition,
  run: typeof demoScenarioRuns.$inferSelect,
  records: DemoRecordReference[] = [],
) {
  return demoHandlerInputSchema.parse({
    scenarioKey: definition.key,
    scenarioVersion: definition.version,
    runId: run.id,
    generation: run.generation,
    locale: run.locale,
    records,
  });
}

async function recordsFor(
  tx: Tx,
  run: typeof demoScenarioRuns.$inferSelect,
  fixture: DemoFixtureContribution,
): Promise<DemoRecordReference[]> {
  const rows = await tx
    .select()
    .from(demoRecords)
    .where(
      and(
        eq(demoRecords.runId, run.id),
        eq(demoRecords.generation, run.generation),
        eq(demoRecords.contributionKey, fixture.key),
        eq(demoRecords.contributionVersion, fixture.version),
      ),
    )
    .orderBy(asc(demoRecords.fixtureKey));
  return rows.map((row) => ({
    fixtureKey: row.fixtureKey,
    subjectType: row.subjectType,
    subjectId: row.subjectId,
    label: row.label,
  }));
}

function validateRecords(
  fixture: DemoFixtureContribution,
  records: DemoRecordReference[],
): void {
  const declared = new Map(fixture.records.map((record) => [record.key, record]));
  const returned = new Set<string>();
  for (const record of records) {
    const expected = declared.get(record.fixtureKey);
    if (!expected || expected.subjectType !== record.subjectType) {
      throw new ServiceError(
        "conflict",
        `Fixture ${fixture.key} returned undeclared record ${record.fixtureKey}.`,
      );
    }
    if (returned.has(record.fixtureKey)) {
      throw new ServiceError(
        "conflict",
        `Fixture ${fixture.key} returned ${record.fixtureKey} more than once.`,
      );
    }
    returned.add(record.fixtureKey);
  }
  const missing = fixture.records.find((record) => !returned.has(record.key));
  if (missing) {
    throw new ServiceError(
      "conflict",
      `Fixture ${fixture.key} did not return declared record ${missing.key}.`,
    );
  }
}

async function verifyFixture(
  ctx: ServiceContext,
  definition: DemoScenarioDefinition,
  run: typeof demoScenarioRuns.$inferSelect,
  fixture: DemoFixtureContribution,
  expected: boolean,
): Promise<void> {
  const records = await recordsFor(ctx.tx, run, fixture);
  const raw = await ctx.callAsSystem(
    contributionService(fixture.verifyService),
    handlerInput(definition, run, records),
  );
  const result = demoVerifyResultSchema.parse(raw);
  const byKey = new Map(result.outcomes.map((outcome) => [outcome.key, outcome]));
  for (const declared of fixture.expectedOutcomes) {
    const outcome = byKey.get(declared.key);
    if (!outcome || outcome.achieved !== expected) {
      throw new ServiceError(
        "conflict",
        expected
          ? `Fixture ${fixture.key} did not achieve ${declared.key}.`
          : `Fixture ${fixture.key} cleanup left ${declared.key} behind.`,
      );
    }
  }
  const undeclared = result.outcomes.find(
    (outcome) => !fixture.expectedOutcomes.some(({ key }) => key === outcome.key),
  );
  if (undeclared) {
    throw new ServiceError(
      "conflict",
      `Fixture ${fixture.key} verified undeclared outcome ${undeclared.key}.`,
    );
  }
}

async function loadGeneration(
  ctx: ServiceContext,
  definition: DemoScenarioDefinition,
  run: typeof demoScenarioRuns.$inferSelect,
): Promise<void> {
  for (const fixture of orderedFixtures(definition)) {
    const raw = await ctx.callAsSystem(
      contributionService(fixture.loadService),
      handlerInput(definition, run),
    );
    const result = demoLoadResultSchema.parse(raw);
    validateRecords(fixture, result.records);
    await ctx.tx.insert(demoRecords).values(
      result.records.map((record) => ({
        runId: run.id,
        generation: run.generation,
        contributionKey: fixture.key,
        contributionVersion: fixture.version,
        fixtureKey: record.fixtureKey,
        subjectType: record.subjectType,
        subjectId: record.subjectId,
        label: record.label,
      })),
    );
  }
  for (const fixture of orderedFixtures(definition)) {
    await verifyFixture(ctx, definition, run, fixture, true);
  }
}

async function purgeGeneration(
  ctx: ServiceContext,
  definition: DemoScenarioDefinition,
  run: typeof demoScenarioRuns.$inferSelect,
): Promise<void> {
  for (const fixture of [...orderedFixtures(definition)].reverse()) {
    const records = await recordsFor(ctx.tx, run, fixture);
    validateRecords(fixture, records);
    const raw = await ctx.callAsSystem(
      contributionService(fixture.purgeService),
      handlerInput(definition, run, records),
    );
    const result = demoPurgeResultSchema.parse(raw);
    const purged = new Set(
      result.purged.map((record) => `${record.subjectType}:${record.subjectId}`),
    );
    const missing = records.find(
      (record) => !purged.has(`${record.subjectType}:${record.subjectId}`),
    );
    if (missing) {
      throw new ServiceError(
        "conflict",
        `Fixture ${fixture.key} did not account for purging ${missing.fixtureKey}.`,
      );
    }
    await verifyFixture(ctx, definition, run, fixture, false);
  }
}

async function activeRun(tx: Tx) {
  const [run] = await tx
    .select()
    .from(demoScenarioRuns)
    .where(eq(demoScenarioRuns.status, "active"))
    .limit(1);
  return run;
}

async function insertRun(
  ctx: ServiceContext,
  definition: DemoScenarioDefinition,
  locale: string,
) {
  const [run] = await ctx.tx
    .insert(demoScenarioRuns)
    .values({
      scenarioKey: definition.key,
      scenarioVersion: definition.version,
      locale,
    })
    .returning();
  await loadGeneration(ctx, definition, run!);
  return run!;
}

async function markPurged(ctx: ServiceContext, run: typeof demoScenarioRuns.$inferSelect) {
  const now = new Date();
  await ctx.tx
    .update(demoScenarioRuns)
    .set({ status: "purged", purgedAt: now, updatedAt: now })
    .where(eq(demoScenarioRuns.id, run.id));
}

const scenarioInput = z.object({
  key: z.string().regex(/^[a-z][a-z0-9.-]*$/).max(120),
  version: z.number().int().positive().optional(),
  locale: z.string().regex(/^[a-z]{2,3}(?:-[A-Z]{2})?$/).optional(),
});

const demoRunRow = row({
  id: uuid,
  scenarioKey: z.string(),
  scenarioVersion: z.number().int(),
  locale: z.string(),
  generation: z.number().int(),
  status: z.enum(["active", "purged"]),
  loadedAt: timestamp,
  purgedAt: timestamp.nullable(),
  updatedAt: timestamp,
});

const demoScenarioRow = row({
  key: z.string(),
  version: z.number().int(),
  titleKey: z.string(),
  descriptionKey: z.string(),
  preset: z.string(),
  requiredModules: z.array(z.string()),
  requiredCapabilities: z.array(z.string()),
  fixtureManifest: z.unknown(),
  defaultLocale: z.string(),
  supportedLocales: z.array(z.string()),
  tourFlowKey: z.string().nullable(),
  status: z.enum(["draft", "active", "retired"]),
  createdAt: timestamp,
  updatedAt: timestamp,
  activeRun: demoRunRow.nullable(),
});

export const listDemoScenarios = defineService({
  name: "demo.list",
  summary: "List available deterministic demo scenarios and the active run.",
  kind: "query",
  permission: "scoped",
  input: z.object({}),
  output: listed(demoScenarioRow),
  handler: async (_input, ctx) => {
    const rows = await ctx.tx
      .select()
      .from(demoScenarios)
      .where(eq(demoScenarios.status, "active"))
      .orderBy(asc(demoScenarios.key), desc(demoScenarios.version));
    const latest = new Map<string, typeof rows[number]>();
    for (const row of rows) if (!latest.has(row.key)) latest.set(row.key, row);
    const run = await activeRun(ctx.tx);
    return [...latest.values()]
      .filter((row) => {
        const definition = demoScenario(row.key, row.version);
        return Boolean(
          definition &&
            definition.requiredCapabilities.every((capability) =>
              actorHasGuidanceCapability(ctx.actor, capability),
            ),
        );
      })
      .map((row) => ({
        ...row,
        fixtureManifest: row.fixtureManifest as DemoFixtureContribution[],
        activeRun:
          run?.scenarioKey === row.key && run.scenarioVersion === row.version
            ? run
            : null,
      }));
  },
});

export const loadDemoScenario = defineService({
  name: "demo.load",
  summary: "Load a deterministic demo scenario, or return its existing active run.",
  kind: "mutation",
  permission: "scoped",
  input: scenarioInput,
  output: z.object({
    action: z.enum(["unchanged", "loaded"]),
    run: demoRunRow,
  }),
  handler: async (input, ctx) => {
    await syncOnboardingDefinitions(ctx.tx);
    const definition = latestScenario(input.key, input.version);
    requireCapabilities(ctx.actor, definition);
    const locale = input.locale ?? definition.defaultLocale;
    if (!definition.supportedLocales.includes(locale)) {
      throw new ServiceError(
        "validation",
        `${definition.key} does not provide a ${locale} locale variant.`,
      );
    }
    const current = await activeRun(ctx.tx);
    if (current) {
      if (
        current.scenarioKey !== definition.key ||
        current.scenarioVersion !== definition.version ||
        current.locale !== locale
      ) {
        throw new ServiceError(
          "conflict",
          "Another demo scenario is active. Purge it or reset into this scenario.",
        );
      }
      for (const fixture of orderedFixtures(definition)) {
        await verifyFixture(ctx, definition, current, fixture, true);
      }
      ctx.setSubject("demo_scenario_run", current.id);
      return { action: "unchanged" as const, run: current };
    }
    const run = await insertRun(ctx, definition, locale);
    ctx.setSubject("demo_scenario_run", run.id);
    return { action: "loaded" as const, run };
  },
});

export const reloadDemoScenario = defineService({
  name: "demo.reload",
  summary: "Purge and reload the active scenario as a new deterministic generation.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({}),
  output: z.object({
    action: z.literal("reloaded"),
    run: demoRunRow,
  }),
  handler: async (_input, ctx) => {
    await syncOnboardingDefinitions(ctx.tx);
    const current = await activeRun(ctx.tx);
    if (!current) throw new ServiceError("not_found", "No demo scenario is active.");
    const definition = latestScenario(current.scenarioKey, current.scenarioVersion);
    requireCapabilities(ctx.actor, definition);
    await purgeGeneration(ctx, definition, current);
    const now = new Date();
    const [run] = await ctx.tx
      .update(demoScenarioRuns)
      .set({ generation: current.generation + 1, loadedAt: now, updatedAt: now })
      .where(eq(demoScenarioRuns.id, current.id))
      .returning();
    await loadGeneration(ctx, definition, run!);
    ctx.setSubject("demo_scenario_run", run!.id);
    return { action: "reloaded" as const, run: run! };
  },
});

export const resetDemoScenario = defineService({
  name: "demo.reset",
  summary: "Purge any active demo and load a fresh run of the selected scenario.",
  kind: "mutation",
  permission: "scoped",
  input: scenarioInput,
  output: z.object({
    action: z.literal("reset"),
    run: demoRunRow,
  }),
  handler: async (input, ctx) => {
    await syncOnboardingDefinitions(ctx.tx);
    const definition = latestScenario(input.key, input.version);
    requireCapabilities(ctx.actor, definition);
    const locale = input.locale ?? definition.defaultLocale;
    if (!definition.supportedLocales.includes(locale)) {
      throw new ServiceError(
        "validation",
        `${definition.key} does not provide a ${locale} locale variant.`,
      );
    }
    const current = await activeRun(ctx.tx);
    if (current) {
      const currentDefinition = latestScenario(
        current.scenarioKey,
        current.scenarioVersion,
      );
      await purgeGeneration(ctx, currentDefinition, current);
      await markPurged(ctx, current);
    }
    const run = await insertRun(ctx, definition, locale);
    ctx.setSubject("demo_scenario_run", run.id);
    return { action: "reset" as const, run };
  },
});

export const purgeDemoScenario = defineService({
  name: "demo.purge",
  summary: "Remove exactly the records proven to belong to the active demo run.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({}),
  output: z.object({
    action: z.enum(["unchanged", "purged"]),
    run: demoRunRow.nullable(),
  }),
  handler: async (_input, ctx) => {
    const current = await activeRun(ctx.tx);
    if (!current) return { action: "unchanged" as const, run: null };
    const definition = latestScenario(current.scenarioKey, current.scenarioVersion);
    requireCapabilities(ctx.actor, definition);
    await purgeGeneration(ctx, definition, current);
    await markPurged(ctx, current);
    ctx.setSubject("demo_scenario_run", current.id);
    return {
      action: "purged" as const,
      run: { ...current, status: "purged" as const },
    };
  },
});

export default [
  listDemoScenarios,
  loadDemoScenario,
  reloadDemoScenario,
  resetDemoScenario,
  purgeDemoScenario,
];
