// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Plugin manifest contract (MASTER.md §24–§26, C3.08).
//
// A plugin is a module plus the fields install, doctor and a registry need:
// which platform versions it supports, which permissions it asks for, which
// migrations it owns, and what extra capabilities it contributes.
import { parseSemver, satisfies } from "./semver.ts";

export const PLUGIN_PERMISSION_PATTERN =
  /^(network:external|[a-z][a-z0-9-]*:(view|manage|read|create|write))$/;

export const PLUGIN_NAME_PATTERN = /^[a-z][a-z0-9-]*$/;
export const SPDX_PATTERN = /^[A-Za-z0-9.+-]+$/;

export type PluginAccess = "view" | "manage";

export type PluginCapabilityKind =
  | "blocks"
  | "adapters"
  | "widgets"
  | "automations"
  | "importers"
  | "themeHooks";

export type AdapterFamily =
  | "payments"
  | "mail"
  | "storage"
  | "sms"
  | "calendar"
  | "ai"
  | "agent";

export type PluginCapabilities = {
  blocks?: boolean;
  adapters?: AdapterFamily[];
  widgets?: boolean;
  automations?: boolean;
  importers?: boolean;
  themeHooks?: boolean;
};

export type PluginPermission = {
  raw: string;
  module: string;
  access: PluginAccess | "external";
};

export type PluginManifestFields = {
  kind: "plugin";
  freeholder: string;
  license: string;
  permissions: string[];
  migrations: string[];
  capabilities: PluginCapabilities;
};

export class PluginContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PluginContractError";
  }
}

export function parsePermission(raw: string): PluginPermission {
  if (!PLUGIN_PERMISSION_PATTERN.test(raw)) {
    throw new PluginContractError(
      `Permission "${raw}" is not a scope. Use module:view, module:manage, or network:external.`,
    );
  }
  if (raw === "network:external") {
    return { raw, module: "network", access: "external" };
  }
  const [module, verb] = raw.split(":") as [string, string];
  const access: PluginAccess =
    verb === "view" || verb === "read" ? "view" : "manage";
  return { raw, module, access };
}

export function describePermission(permission: PluginPermission): string {
  if (permission.access === "external") {
    return "can make outbound network requests";
  }
  if (permission.access === "view") {
    return `can view ${permission.module}`;
  }
  return `can manage ${permission.module}`;
}

export type PluginContractInput = {
  name: string;
  version: string;
  freeholder: string;
  license: string;
  permissions?: string[];
  requires?: string[];
  migrations?: string[];
  capabilities?: PluginCapabilities;
};

export function validatePluginContract(input: PluginContractInput): PluginManifestFields {
  if (!PLUGIN_NAME_PATTERN.test(input.name)) {
    throw new PluginContractError(
      `Plugin name "${input.name}" must be lowercase letters, digits and hyphens.`,
    );
  }
  if (!parseSemver(input.version)) {
    throw new PluginContractError(
      `Plugin version "${input.version}" must be semver (for example 0.1.0).`,
    );
  }
  if (!rangeLooksValid(input.freeholder)) {
    throw new PluginContractError(
      `freeholder range "${input.freeholder}" is not a semver range.`,
    );
  }
  if (!SPDX_PATTERN.test(input.license)) {
    throw new PluginContractError(
      `license "${input.license}" is not an SPDX identifier.`,
    );
  }
  const permissions = input.permissions ?? [];
  for (const permission of permissions) parsePermission(permission);
  const requires = input.requires ?? [];
  for (const name of requires) {
    if (!PLUGIN_NAME_PATTERN.test(name)) {
      throw new PluginContractError(
        `Dependency "${name}" is not a module name.`,
      );
    }
  }
  const migrations = input.migrations ?? [];
  for (const file of migrations) {
    if (!/^[A-Za-z0-9._-]+\.sql$/.test(file)) {
      throw new PluginContractError(
        `Migration "${file}" must be a .sql filename.`,
      );
    }
  }
  return {
    kind: "plugin",
    freeholder: input.freeholder.trim(),
    license: input.license,
    permissions,
    migrations,
    capabilities: input.capabilities ?? {},
  };
}

function rangeLooksValid(range: string): boolean {
  const tokens = range.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return false;
  return tokens.every((token) => satisfies("0.0.0", token) || satisfies("1.0.0", token) || looksLikeComparator(token));
}

function looksLikeComparator(token: string): boolean {
  return /^(?:\^|~|>=|<=|>|<|=)?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(token);
}

export function pluginFitsPlatform(range: string, platformVersion: string): boolean {
  if (!parseSemver(platformVersion)) {
    throw new PluginContractError(
      `Platform version "${platformVersion}" is not semver.`,
    );
  }
  return satisfies(platformVersion, range);
}
