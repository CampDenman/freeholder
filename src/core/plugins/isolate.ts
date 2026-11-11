// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// A bad plugin is named and skipped, never a downed instance (C3.10).
import type { ModuleManifest } from "@/core/module";
import { PluginContractError } from "@freeholder/plugin-kit";
import { assertPluginFitsInstance, isPluginManifest } from "@/core/plugin";

export type IsolatedPlugin = {
  manifest: ModuleManifest;
  error?: string;
};

export function isolatePlugins(
  manifests: ModuleManifest[],
  installedNames: readonly string[],
): IsolatedPlugin[] {
  const isolated = manifests.map((manifest): IsolatedPlugin => {
    if (!isPluginManifest(manifest)) return { manifest };
    try {
      if (manifests.some(other => other !== manifest && other.name === manifest.name)) throw new PluginContractError(`Plugin "${manifest.name}" uses a name already claimed by another module.`);
      assertPluginFitsInstance(manifest, { installed: installedNames });
      return { manifest };
    } catch (error) {
      return { manifest, error: isolateError(error) };
    }
  });
  // A disabled dependency disables its plugin dependants too; otherwise
  // topo-sort would turn one incompatible extension into a whole-site crash.
  let changed = true;
  while (changed) {
    changed = false;
    const disabled = new Set(isolated.filter(entry => entry.error).map(entry => entry.manifest.name));
    for (const entry of isolated) {
      if (entry.error || !isPluginManifest(entry.manifest)) continue;
      const missing = entry.manifest.requires?.find(name => disabled.has(name));
      if (missing) { entry.error = `Plugin dependency "${missing}" is disabled.`; changed = true; }
    }
  }
  return isolated;
}

export function bootableManifests(isolated: IsolatedPlugin[]): ModuleManifest[] {
  return isolated.filter((entry) => !entry.error).map((entry) => entry.manifest);
}

export function isolateError(error: unknown): string {
  if (error instanceof PluginContractError || error instanceof Error) {
    return error.message;
  }
  return String(error);
}

/** Wrap one plugin contribution so a throw becomes a named disable, not a crash. */
export async function isolatePluginLoad<T>(
  name: string,
  work: () => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  try {
    return { ok: true, value: await work() };
  } catch (error) {
    return { ok: false, error: `${name}: ${isolateError(error)}` };
  }
}
