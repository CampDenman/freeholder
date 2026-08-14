// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The public onboarding extension contract (MASTER.md sections 13 and 24).
// Modules and plugins describe targets, guidance and deterministic fixtures;
// executable work remains in ordinary services so every write keeps the same
// authorization, transaction and audit guarantees as the rest of Freeholder.
import { z } from "zod";
import {
  capabilitySchema,
  guidanceFlowDefinitionSchema,
} from "@/core/guidance/definitions";

const key = z.string().regex(/^[a-z][a-z0-9.-]*$/).max(120);
const serviceName = z
  .string()
  .regex(/^[a-z][a-z0-9-]*\.[A-Za-z][A-Za-z0-9]*$/)
  .max(160);
const locale = z.string().regex(/^[a-z]{2,3}(?:-[A-Z]{2})?$/);

export const onboardingTargetSchema = z.object({
  key,
  href: z.string().regex(/^\/(?!\/)[^\s]*$/),
  selector: z.string().min(1).max(200).optional(),
  requiredModules: z.array(key).default([]),
  requiredCapabilities: z.array(capabilitySchema).default([]),
});

export const demoExpectedOutcomeSchema = z.object({
  key,
  labelKey: z.string().min(1).max(160),
  targetKey: key,
});

export const demoFixtureRecordSchema = z.object({
  key,
  subjectType: z.string().regex(/^[a-z][a-z0-9_]*$/).max(80),
});

export const demoFixtureContributionSchema = z.object({
  key,
  version: z.number().int().positive(),
  scenarioKeys: z.array(key).min(1),
  dependsOn: z
    .array(z.object({ key, version: z.number().int().positive() }))
    .default([]),
  requiredModules: z.array(key).min(1),
  requiredCapabilities: z.array(capabilitySchema).default([]),
  localeVariants: z.array(locale).min(1),
  records: z.array(demoFixtureRecordSchema).min(1),
  expectedOutcomes: z.array(demoExpectedOutcomeSchema).min(1),
  loadService: serviceName,
  purgeService: serviceName,
  verifyService: serviceName,
});

export const demoScenarioDefinitionSchema = z.object({
  key,
  version: z.number().int().positive(),
  titleKey: z.string().min(1).max(160),
  descriptionKey: z.string().min(1).max(160),
  preset: z.string().regex(/^[a-z][a-z0-9-]*$/).max(80),
  requiredModules: z.array(key).min(1),
  requiredCapabilities: z.array(capabilitySchema).default([]),
  fixtureContributions: z
    .array(z.object({ key, version: z.number().int().positive() }))
    .min(1),
  defaultLocale: locale,
  supportedLocales: z.array(locale).min(1),
  tourFlowKey: key.optional(),
  status: z.enum(["draft", "active", "retired"]),
});

export const onboardingModuleExportSchema = z.object({
  targets: z.array(onboardingTargetSchema).default([]),
  guidance: z.array(guidanceFlowDefinitionSchema).default([]),
  scenarios: z.array(demoScenarioDefinitionSchema).default([]),
  fixtures: z.array(demoFixtureContributionSchema).default([]),
});

export const demoRecordReferenceSchema = z.object({
  fixtureKey: key,
  subjectType: z.string().regex(/^[a-z][a-z0-9_]*$/).max(80),
  subjectId: z.string().min(1).max(200),
  label: z.string().min(1).max(240),
});

export const demoHandlerInputSchema = z.object({
  scenarioKey: key,
  scenarioVersion: z.number().int().positive(),
  runId: z.string().uuid(),
  generation: z.number().int().positive(),
  locale,
  records: z.array(demoRecordReferenceSchema).default([]),
});

export const demoLoadResultSchema = z.object({
  records: z.array(demoRecordReferenceSchema).min(1),
});

export const demoPurgeResultSchema = z.object({
  purged: z.array(
    z.object({
      subjectType: z.string().regex(/^[a-z][a-z0-9_]*$/).max(80),
      subjectId: z.string().min(1).max(200),
    }),
  ),
});

export const demoVerifyResultSchema = z.object({
  outcomes: z.array(
    z.object({
      key,
      achieved: z.boolean(),
      detail: z.string().max(300).optional(),
    }),
  ),
});

export type OnboardingTarget = z.infer<typeof onboardingTargetSchema>;
export type DemoFixtureContribution = z.infer<
  typeof demoFixtureContributionSchema
>;
export type DemoScenarioDefinition = z.infer<
  typeof demoScenarioDefinitionSchema
>;
export type OnboardingModuleExport = z.infer<
  typeof onboardingModuleExportSchema
>;
export type DemoRecordReference = z.infer<typeof demoRecordReferenceSchema>;
export type DemoHandlerInput = z.infer<typeof demoHandlerInputSchema>;
