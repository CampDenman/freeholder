// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Importer authoring contract (C3.21). Core keeps preview, commit and rollback.
import { PluginContractError } from "./contract";

export type ImporterSourceKind =
  | "wordpress-rest"
  | "wordpress-wxr"
  | "sitemap"
  | "rss"
  | "atom"
  | "html"
  | "archive";

export type ImporterAuthConfig =
  | { kind: "none" }
  | { kind: "basic"; username: string }
  | { kind: "bearer" };

export type ImporterDefinitionInput = {
  name: string;
  source: ImporterSourceKind;
  permissions: string[];
  auth?: ImporterAuthConfig;
};

export function defineImporter<T extends ImporterDefinitionInput>(input: T): T {
  if (!/^[a-z][a-z0-9-]*$/.test(input.name)) {
    throw new PluginContractError(`Importer name "${input.name}" is not a plugin name.`);
  }
  if (!input.permissions.includes("network:external")) {
    throw new PluginContractError(
      `Importer "${input.name}" must declare network:external to fetch a source.`,
    );
  }
  return input;
}
