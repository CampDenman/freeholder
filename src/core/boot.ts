// Copyright (C) 2026 Camp Denman Society
// SPDX-License-Identifier: AGPL-3.0-only
// The boot sequence (MASTER.md §11): load manifests → topo-sort by requires →
// register services in the registry → subscribe event listeners.
//
// Two steps from the doc are deliberately absent, because doing them here
// would be a lie about how this repo works: migrations are global (one
// db/migrations folder, run by drizzle-kit or the test globalSetup, not
// per-module), and routes, jobs and MCP tools have no surfaces to mount yet.
// Each joins this function in the PR that gives it something to mount.
import { requireProductionEnv } from "@/core/env";
import { subscribe } from "@/core/events";
import { sortModules, type ModuleManifest } from "@/core/module";
import { registerService, type Service } from "@/core/service";

export interface BootReport {
  /** Modules in the order they were wired. */
  modules: string[];
  /** Every service name now reachable through the registry. */
  services: string[];
  listeners: Array<{ event: string; module: string; handler: string }>;
}

function isService(value: unknown): value is Service {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Service).call === "function" &&
    typeof (value as Service).def?.name === "string"
  );
}

export async function boot(
  manifests: ModuleManifest[],
): Promise<BootReport> {
  requireProductionEnv();

  const report: BootReport = { modules: [], services: [], listeners: [] };

  for (const manifest of sortModules(manifests)) {
    report.modules.push(manifest.name);
    if (!manifest.services) continue;

    const loaded = await manifest.services();
    const exported = loaded.default;
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

    for (const [event, handlerName] of Object.entries(
      manifest.events?.listens ?? {},
    )) {
      const handler = loaded[handlerName];
      if (typeof handler !== "function") {
        throw new Error(
          `module "${manifest.name}" listens for "${event}" with "${handlerName}", but its services module exports no such function.`,
        );
      }
      subscribe(event, handler as (payload: unknown) => void | Promise<void>);
      report.listeners.push({
        event,
        module: manifest.name,
        handler: handlerName,
      });
    }
  }

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
}
