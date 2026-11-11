// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.40: failures are recorded after business rollback, never under its lock.
import { AdapterError } from "@/adapters/types";
import { ServiceError } from "@/core/service";
import type { BusHandler } from "@/core/events";
import type { JobDefinition } from "@/core/jobs";
import { deferPluginFailures, pluginNamespace, withPlatformExecution, withPluginExecution, type PluginExecution } from "./context";
import { assertPluginCanRun } from "./permission-policy";

export function unexpectedPluginError(error: unknown): boolean {
  if (error instanceof ServiceError) return error.code === "internal";
  if (error instanceof AdapterError) return false;
  if (error instanceof Error && (["AbortError", "TimeoutError"].includes(error.name) || ("pluginOperationalFailure" in error && error.pluginOperationalFailure === true))) return false;
  if (error && typeof error === "object" && "then" in error && typeof error.then === "function") return false;
  return true;
}

export async function recordPluginFailures(names: Iterable<string>): Promise<void> {
  if (deferPluginFailures(names)) return;
  const { reportPluginFailure } = await import("./permissions");
  await withPlatformExecution(async () => {
    for (const name of new Set(names)) {
      try { await reportPluginFailure.call({ name }, { kind: "system" }); }
      catch { console.error("[plugins] Could not persist a runtime disable; check database health."); }
    }
  });
}

export async function runPluginContribution<T>(plugin: PluginExecution, work: () => Promise<T>): Promise<T> {
  await assertPluginCanRun(plugin);
  try { return await withPluginExecution(plugin, work); }
  catch (error) {
    if (unexpectedPluginError(error)) await recordPluginFailures([plugin.name]);
    throw error;
  }
}

let jobs = new WeakMap<JobDefinition, Map<PluginExecution, JobDefinition>>();
export function pluginJob(plugin: PluginExecution, job: JobDefinition): JobDefinition {
  if (!job.name.startsWith(`${pluginNamespace(plugin.name)}.`)) throw new Error("A plugin may register jobs only in its own namespace.");
  const owners = jobs.get(job) ?? new Map<PluginExecution, JobDefinition>();
  let wrapped = owners.get(plugin);
  if (!wrapped) {
    wrapped = { ...job, handler: async (data, context) => {
      // Empty cron ticks only poll durable domain work. Pausing them does
      // not consume a customer's queued task; one-off payloads still retry.
      if (job.schedule && Object.keys(data).length === 0) {
        try { await assertPluginCanRun(plugin); }
        catch (error) { if (error instanceof ServiceError && ["permission", "conflict"].includes(error.code)) return { skipped: "plugin-disabled" }; throw error; }
      }
      return runPluginContribution(plugin, () => job.handler(data, context));
    } };
    owners.set(plugin, wrapped); jobs.set(job, owners);
  }
  return wrapped;
}

let listeners = new WeakMap<BusHandler, Map<PluginExecution, BusHandler>>();
export function pluginListener(plugin: PluginExecution, handler: BusHandler): BusHandler {
  const owners = listeners.get(handler) ?? new Map<PluginExecution, BusHandler>();
  let wrapped = owners.get(plugin);
  if (!wrapped) {
    wrapped = async (payload, name, context) => { await runPluginContribution(plugin, async () => handler(payload, name, context)); };
    owners.set(plugin, wrapped); listeners.set(handler, owners);
  }
  return wrapped;
}

export function resetPluginRuntimeForTests(): void {
  jobs = new WeakMap(); listeners = new WeakMap();
}
