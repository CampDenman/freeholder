// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Instance-side plugin contract checks (C3.08).
//
// Authoring validation lives in `@freeholder/plugin-kit`. This file asks the
// questions only a running instance can answer: does this platform version
// fit the declared range, and are the required modules actually installed?
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  PluginContractError,
  pluginFitsPlatform,
  type PluginDefinition,
} from "@freeholder/plugin-kit";
import type { ModuleManifest } from "@/core/module";
import { PLATFORM_VERSION } from "@/core/platform";

export {
  definePlugin,
  describePermission,
  parsePermission,
  pluginFitsPlatform,
  PluginContractError,
} from "@freeholder/plugin-kit";

export function isPluginManifest(
  manifest: ModuleManifest,
): manifest is ModuleManifest & PluginDefinition<ModuleManifest & { freeholder: string; license: string }> {
  return manifest.kind === "plugin";
}

export function assertPluginFitsInstance(
  manifest: ModuleManifest,
  options: {
    platformVersion?: string;
    installed: readonly string[];
    migrationsDir?: string;
  },
): void {
  if (!isPluginManifest(manifest)) {
    throw new PluginContractError(
      `"${manifest.name}" is a core module, not a plugin.`,
    );
  }
  const platform = options.platformVersion ?? PLATFORM_VERSION;
  if (!pluginFitsPlatform(manifest.freeholder, platform)) {
    throw new PluginContractError(
      `Plugin "${manifest.name}"@${manifest.version} requires Freeholder ${manifest.freeholder}; this instance is ${platform}.`,
    );
  }
  for (const name of manifest.requires ?? []) {
    if (!options.installed.includes(name)) {
      throw new PluginContractError(
        `Plugin "${manifest.name}" requires module "${name}", which is not installed.`,
      );
    }
  }
  const dir = options.migrationsDir;
  if (!dir) return;
  for (const file of manifest.migrations) {
    if (!existsSync(join(dir, file))) {
      throw new PluginContractError(
        `Plugin "${manifest.name}" declares migration "${file}", which is not in ${dir}.`,
      );
    }
  }
}
