// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The authoring import MASTER.md §24 names: `definePlugin` from this package.
export {
  describePermission,
  parsePermission,
  pluginFitsPlatform,
  validatePluginContract,
  PluginContractError,
  PLUGIN_NAME_PATTERN,
  PLUGIN_PERMISSION_PATTERN,
  SPDX_PATTERN,
  type AdapterFamily,
  type PluginAccess,
  type PluginCapabilities,
  type PluginCapabilityKind,
  type PluginContractInput,
  type PluginManifestFields,
  type PluginPermission,
} from "./contract.ts";
export { parseSemver, satisfies } from "./semver.ts";
export { scaffoldPlugin } from "./scaffold.ts";
export { inspectPluginFolder, EXAMPLE_KINDS } from "./harness.ts";
export { defineImporter, type ImporterDefinitionInput, type ImporterSourceKind } from "./importer.ts";

import {
  validatePluginContract,
  type PluginContractInput,
  type PluginManifestFields,
} from "./contract.ts";

export type PluginDefinition<T extends PluginContractInput> = T & PluginManifestFields;

/**
 * The plugin authoring helper. Validates the contract fields and stamps
 * `kind: "plugin"` so boot can tell a plugin from a core module.
 */
export function definePlugin<T extends PluginContractInput>(input: T): PluginDefinition<T> {
  const fields = validatePluginContract(input);
  return { ...input, ...fields };
}
