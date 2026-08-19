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
  return manifests.map((manifest) => {
    if (!isPluginManifest(manifest)) return { manifest };
    try {
      assertPluginFitsInstance(manifest, { installed: installedNames });
      return { manifest };
    } catch (error) {
      return { manifest, error: isolateError(error) };
    }
  });
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
