// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The boot sequence (MASTER.md §11): load manifests → topo-sort by requires →
// register jobs → register services in the registry → subscribe listeners.
//
// Migrations remain deliberately absent: they are global (one db/migrations
// folder, run before boot or by the test globalSetup), not per-module. Routes
// are App Router files, while the HTTP/MCP registries derive from services.
import { requireProductionEnv } from "@/core/env";
import { subscribe } from "@/core/events";
import { sortModules, type ModuleManifest } from "@/core/module";
import { isolatePlugins, bootableManifests, isolatePluginLoad } from "@/core/plugins/isolate";
import { isPluginManifest } from "@/core/plugin";
import { registerService, type Service } from "@/core/service";
import {
  registerOnboardingModule,
  resetOnboardingRegistryForTests,
  validateOnboardingRegistry,
} from "@/core/onboarding/registry";

export interface BootReport {
  /** Modules in the order they were wired. */
  modules: string[];
  /** Every service name now reachable through the registry. */
  services: string[];
  /** Block types contributed by modules, beyond cms's own vocabulary. */
  blocks: string[];
  /** Background jobs mounted from every module (§11). */
  jobs: string[];
  guidance: string[];
  demoScenarios: string[];
  demoFixtures: string[];
  listeners: Array<{ event: string; module: string; handler: string }>;
}

/**
 * Exported so a test can compare what `defineService` produced against what
 * boot registered. That comparison exists because thirteen services once
 * shipped unregistered — see tests/core/registry-completeness.test.ts.
 */
export function isService(value: unknown): value is Service {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Service).call === "function" &&
    typeof (value as Service).def?.name === "string"
  );
}

async function wireManifest(
  manifest: ModuleManifest,
  report: BootReport,
): Promise<void> {
  if (manifest.blocks) {
    const loaded = await manifest.blocks();
    const exported = loaded.default;
    if (!Array.isArray(exported)) {
      throw new Error(
        `module "${manifest.name}" declares blocks, but its blocks module has no default export array. Export them as \`export default [ ... ]\`.`,
      );
    }
    const { registerBlock } = await import("@/modules/cms/blocks/registry");
    for (const block of exported) {
      registerBlock(block as Parameters<typeof registerBlock>[0]);
      report.blocks.push((block as { type: string }).type);
    }
  }

  if (manifest.jobs) {
    const loaded = await manifest.jobs();
    const exported = loaded.default;
    if (!Array.isArray(exported)) {
      throw new Error(
        `module "${manifest.name}" declares jobs, but its jobs module has no default export array.`,
      );
    }
    const { registerJob } = await import("@/core/jobs");
    for (const job of exported) {
      registerJob(job as Parameters<typeof registerJob>[0]);
      report.jobs.push((job as { name: string }).name);
    }
  }

  let loadedServices: Record<string, unknown> | undefined;
  if (manifest.services) {
    loadedServices = await manifest.services();
    const exported = loadedServices.default;
    if (!Array.isArray(exported)) {
      throw new Error(
        `module "${manifest.name}" declares services, but its services module has no default export array. Export the services as \`export default [ ... ]\`.`,
      );
    }
    for (const service of exported) {
      if (!isService(service)) {
        throw new Error(
          `module "${manifest.name}" exports something that is not a service. Every entry must come from defineService().`,
        );
      }
      registerService(service);
      report.services.push(service.def.name);
    }
  }

  for (const [event, handlerName] of Object.entries(
    manifest.events?.listens ?? {},
  )) {
    const handler = loadedServices?.[handlerName];
    if (typeof handler !== "function") {
      throw new Error(
        `module "${manifest.name}" listens for "${event}" with "${handlerName}", but its services module exports no such function.`,
      );
    }
    subscribe(
      event,
      `${manifest.name}:${event}:${handlerName}`,
      handler as (payload: unknown) => void | Promise<void>,
    );
    report.listeners.push({
      event,
      module: manifest.name,
      handler: handlerName,
    });
  }

  if (manifest.onboarding) {
    const loaded = await manifest.onboarding();
    const contribution = registerOnboardingModule(manifest.name, loaded.default);
    report.guidance.push(
      ...contribution.guidance.map((flow) => `${flow.key}@${flow.version}`),
    );
    report.demoScenarios.push(
      ...contribution.scenarios.map((scenario) => `${scenario.key}@${scenario.version}`),
    );
    report.demoFixtures.push(
      ...contribution.fixtures.map((fixture) => `${fixture.key}@${fixture.version}`),
    );
  }
}

export async function boot(
  manifests: ModuleManifest[],
): Promise<BootReport> {
  requireProductionEnv();

  const report: BootReport = {
    modules: [],
    services: [],
    listeners: [],
    blocks: [],
    jobs: [],
    guidance: [],
    demoScenarios: [],
    demoFixtures: [],
  };

  const installed = manifests.map((manifest) => manifest.name);
  const isolated = isolatePlugins(manifests, installed);
  for (const failed of isolated.filter((entry) => entry.error)) {
    report.modules.push(`${failed.manifest.name} (disabled: ${failed.error})`);
  }
  for (const manifest of sortModules(bootableManifests(isolated))) {
    const wired = await isolatePluginLoad(manifest.name, () =>
      wireManifest(manifest, report),
    );
    if (!wired.ok) {
      if (isPluginManifest(manifest)) {
        report.modules.push(`${manifest.name} (disabled: ${wired.error})`);
        continue;
      }
      throw new Error(wired.error);
    }
    report.modules.push(manifest.name);
  }

  validateOnboardingRegistry({
    installedModules: report.modules,
    registeredServices: report.services,
  });

  return report;
}

let booted: Promise<BootReport> | undefined;

/**
 * Boot at most once per process. The dev server re-imports modules on change
 * and serverless runtimes may invoke an entry point repeatedly; registering a
 * service twice is an error, so the guard belongs here rather than in every
 * caller's head.
 */
export function bootOnce(manifests: ModuleManifest[]): Promise<BootReport> {
  booted ??= boot(manifests);
  return booted;
}

export function resetBootForTests(): void {
  booted = undefined;
  resetOnboardingRegistryForTests();
}
