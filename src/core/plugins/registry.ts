// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Signed plugin registry index (MASTER.md §27, C3.11).
import { z } from "zod";
import { signIntegrity, verifySignature } from "./integrity";

export const registryPluginSchema = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
  tier: z.enum(["verified", "community", "private", "local"]),
  license: z.string().min(1),
  permissions: z.array(z.string()),
  freeholder: z.string().min(1),
  integrity: z.string().min(1),
  changelog: z.string().min(1),
  description: z.string().optional(),
  repo: z.string().optional(),
});

export const registryIndexSchema = z.object({
  registry: z.string().min(1),
  updated: z.string().min(1),
  plugins: z.array(registryPluginSchema),
});

export type RegistryIndex = z.infer<typeof registryIndexSchema>;

export function parseRegistryIndex(value: unknown): RegistryIndex {
  const parsed = registryIndexSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error("That registry index is not a signed Freeholder catalog.");
  }
  for (const plugin of parsed.data.plugins) {
    if (!plugin.changelog.trim()) {
      throw new Error(`${plugin.name}@${plugin.version} is missing a changelog entry.`);
    }
  }
  return parsed.data;
}

export function canonicalRegistryIndex(index: RegistryIndex): string {
  return JSON.stringify({
    registry: index.registry,
    updated: index.updated,
    plugins: index.plugins.map((plugin) => ({
      name: plugin.name,
      version: plugin.version,
      tier: plugin.tier,
      license: plugin.license,
      permissions: plugin.permissions,
      freeholder: plugin.freeholder,
      integrity: plugin.integrity,
      changelog: plugin.changelog,
      description: plugin.description ?? "",
      repo: plugin.repo ?? "",
    })),
  });
}

export function signRegistryIndex(index: RegistryIndex, secret: string): string {
  return signIntegrity(canonicalRegistryIndex(index), secret);
}

export function verifyRegistryIndex(
  index: RegistryIndex,
  signature: string,
  secret: string,
): boolean {
  return verifySignature(canonicalRegistryIndex(index), signature, secret);
}
