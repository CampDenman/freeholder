// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Cross-module onboarding registry and conformance harness.
import {
  onboardingModuleExportSchema,
  type DemoFixtureContribution,
  type DemoScenarioDefinition,
  type OnboardingModuleExport,
  type OnboardingTarget,
} from "@/core/onboarding/contract";
import type { GuidanceFlowDefinition } from "@/core/guidance/definitions";

interface Owned<T> {
  module: string;
  value: T;
}

interface RegistryState {
  targets: Map<string, Owned<OnboardingTarget>>;
  guidance: Map<string, Owned<GuidanceFlowDefinition>>;
  scenarios: Map<string, Owned<DemoScenarioDefinition>>;
  fixtures: Map<string, Owned<DemoFixtureContribution>>;
}

const state: RegistryState = {
  targets: new Map(),
  guidance: new Map(),
  scenarios: new Map(),
  fixtures: new Map(),
};

function identity(value: { key: string; version?: number }): string {
  return value.version === undefined ? value.key : `${value.key}@${value.version}`;
}

function insert<T extends { key: string; version?: number }>(
  map: Map<string, Owned<T>>,
  module: string,
  value: T,
  kind: string,
): void {
  const id = identity(value);
  const prior = map.get(id);
  if (prior) {
    // Boot is a request-graph precondition as well as a startup action. The
    // exact same manifest may therefore be registered again in one process,
    // just as the service registry accepts the same service object twice.
    if (
      prior.module === module &&
      JSON.stringify(prior.value) === JSON.stringify(value)
    ) {
      return;
    }
    throw new Error(
      `module "${module}" contributes ${kind} "${id}", already contributed by module "${prior.module}"`,
    );
  }
  map.set(id, { module, value });
}

export function registerOnboardingModule(
  module: string,
  raw: unknown,
): OnboardingModuleExport {
  const contribution = onboardingModuleExportSchema.parse(raw);
  for (const value of [
    ...contribution.targets,
    ...contribution.guidance,
    ...contribution.scenarios,
    ...contribution.fixtures,
  ]) {
    if (!value.key.startsWith(`${module}.`)) {
      throw new Error(
        `module "${module}" contributes onboarding key "${value.key}" outside its namespace`,
      );
    }
  }
  for (const target of contribution.targets) {
    insert(state.targets, module, target, "onboarding target");
  }
  for (const guidance of contribution.guidance) {
    insert(state.guidance, module, guidance, "guidance flow");
  }
  for (const scenario of contribution.scenarios) {
    insert(state.scenarios, module, scenario, "demo scenario");
  }
  for (const fixture of contribution.fixtures) {
    for (const handler of [
      fixture.loadService,
      fixture.purgeService,
      fixture.verifyService,
    ]) {
      if (!handler.startsWith(`${module}.`)) {
        throw new Error(
          `module "${module}" fixture "${fixture.key}" uses handler "${handler}" outside its service namespace`,
        );
      }
    }
    insert(state.fixtures, module, fixture, "demo fixture");
  }
  return contribution;
}

function accessLevel(capability: string): number {
  return capability.endsWith(":manage") ? 2 : 1;
}

function capabilityCovers(held: string, required: string): boolean {
  const [heldModule] = held.split(":");
  const [requiredModule] = required.split(":");
  return (
    (heldModule === "*" || heldModule === requiredModule) &&
    accessLevel(held) >= accessLevel(required)
  );
}

function coversAll(held: readonly string[], required: readonly string[]): boolean {
  return required.every((need) =>
    held.some((capability) => capabilityCovers(capability, need)),
  );
}

function duplicates(values: readonly string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    if (seen.has(value)) return true;
    seen.add(value);
    return false;
  });
}

function fail(message: string): never {
  throw new Error(`onboarding conformance: ${message}`);
}

export interface OnboardingConformanceOptions {
  installedModules: Iterable<string>;
  registeredServices: Iterable<string>;
  /** Optional route/selector inventory used by the plugin development harness. */
  availableTargets?: Iterable<string>;
}

export function validateOnboardingRegistry(
  options: OnboardingConformanceOptions,
): void {
  const installed = new Set(options.installedModules);
  const services = new Set(options.registeredServices);
  const availableTargets = options.availableTargets
    ? new Set(options.availableTargets)
    : undefined;

  for (const { value: target } of state.targets.values()) {
    // Targets may describe optional-module screens. They are retained so core
    // guidance can be assembled once those modules are installed; fixtures
    // and scenarios below enforce hard dependency presence.
    if (availableTargets) {
      const address = `${target.href}${target.selector ?? ""}`;
      if (!availableTargets.has(address)) {
        fail(`target "${target.key}" is stale or missing: ${address}`);
      }
    }
  }

  for (const { value: flow } of state.guidance.values()) {
    for (const step of flow.steps) {
      const target = [...state.targets.values()].find(
        ({ value }) => value.href === step.href,
      )?.value;
      if (!target) {
        fail(`guidance "${flow.key}" step "${step.key}" has undeclared target ${step.href}`);
      }
      if (!coversAll(step.requiredCapabilities, target.requiredCapabilities)) {
        fail(`guidance "${flow.key}" step "${step.key}" does not require its target capabilities`);
      }
    }
  }

  for (const { value: fixture } of state.fixtures.values()) {
    const missing = fixture.requiredModules.filter((module) => !installed.has(module));
    if (missing.length) {
      fail(`fixture "${fixture.key}" requires missing module(s): ${missing.join(", ")}`);
    }
    for (const dependency of fixture.dependsOn) {
      const id = `${dependency.key}@${dependency.version}`;
      if (!state.fixtures.has(id)) {
        fail(`fixture "${fixture.key}" depends on missing fixture "${id}"`);
      }
    }
    for (const handler of [
      fixture.loadService,
      fixture.purgeService,
      fixture.verifyService,
    ]) {
      if (!services.has(handler)) {
        fail(`fixture "${fixture.key}" declares missing handler service "${handler}"`);
      }
    }
    const duplicateRecords = duplicates(fixture.records.map((record) => record.key));
    if (duplicateRecords.length) {
      fail(`fixture "${fixture.key}" repeats record key "${duplicateRecords[0]}"`);
    }
    const duplicateOutcomes = duplicates(
      fixture.expectedOutcomes.map((outcome) => outcome.key),
    );
    if (duplicateOutcomes.length) {
      fail(`fixture "${fixture.key}" repeats outcome key "${duplicateOutcomes[0]}"`);
    }
    for (const outcome of fixture.expectedOutcomes) {
      if (!state.targets.has(outcome.targetKey)) {
        fail(`fixture "${fixture.key}" outcome "${outcome.key}" names missing target "${outcome.targetKey}"`);
      }
    }
  }

  for (const { value: scenario } of state.scenarios.values()) {
    const missing = scenario.requiredModules.filter((module) => !installed.has(module));
    if (missing.length) {
      fail(`scenario "${scenario.key}" requires missing module(s): ${missing.join(", ")}`);
    }
    if (!scenario.supportedLocales.includes(scenario.defaultLocale)) {
      fail(`scenario "${scenario.key}" does not include its default locale`);
    }
    const fixtures = scenario.fixtureContributions.map((reference) => {
      const id = `${reference.key}@${reference.version}`;
      const fixture = state.fixtures.get(id)?.value;
      if (!fixture) fail(`scenario "${scenario.key}" names missing fixture "${id}"`);
      if (!fixture.scenarioKeys.includes(scenario.key)) {
        fail(`fixture "${id}" does not opt in to scenario "${scenario.key}"`);
      }
      return fixture;
    });
    for (const fixture of fixtures) {
      if (!fixture.requiredModules.every((module) => scenario.requiredModules.includes(module))) {
        fail(`scenario "${scenario.key}" does not declare every module required by fixture "${fixture.key}"`);
      }
      if (!coversAll(scenario.requiredCapabilities, fixture.requiredCapabilities)) {
        fail(`scenario "${scenario.key}" does not declare every capability required by fixture "${fixture.key}"`);
      }
      const missingLocale = scenario.supportedLocales.find(
        (locale) => !fixture.localeVariants.includes(locale),
      );
      if (missingLocale) {
        fail(`fixture "${fixture.key}" has no ${missingLocale} locale variant required by scenario "${scenario.key}"`);
      }
      for (const outcome of fixture.expectedOutcomes) {
        const target = state.targets.get(outcome.targetKey)!.value;
        if (!coversAll(scenario.requiredCapabilities, target.requiredCapabilities)) {
          fail(`scenario "${scenario.key}" cannot expose outcome target "${target.key}" with its declared capabilities`);
        }
      }
    }
    if (scenario.tourFlowKey) {
      const exists = [...state.guidance.values()].some(
        ({ value }) => value.key === scenario.tourFlowKey,
      );
      if (!exists) {
        fail(`scenario "${scenario.key}" names missing tour flow "${scenario.tourFlowKey}"`);
      }
    }
  }
}

export function onboardingTargets(): OnboardingTarget[] {
  return [...state.targets.values()].map(({ value }) => value);
}

export function onboardingGuidance(): GuidanceFlowDefinition[] {
  return [...state.guidance.values()].map(({ value }) => value);
}

export function demoScenarios(): DemoScenarioDefinition[] {
  return [...state.scenarios.values()].map(({ value }) => value);
}

export function demoFixtures(): DemoFixtureContribution[] {
  return [...state.fixtures.values()].map(({ value }) => value);
}

export function demoScenario(key: string, version: number): DemoScenarioDefinition | undefined {
  return state.scenarios.get(`${key}@${version}`)?.value;
}

export function demoFixture(
  key: string,
  version: number,
): DemoFixtureContribution | undefined {
  return state.fixtures.get(`${key}@${version}`)?.value;
}

export function resetOnboardingRegistryForTests(): void {
  state.targets.clear();
  state.guidance.clear();
  state.scenarios.clear();
  state.fixtures.clear();
}
