// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Existing product fixtures start after their fake owner approved bundled
// features. They receive exactly each manifest's grants, never a wildcard.
import manifests from "@/modules";
import { isPluginManifest } from "@/core/plugin";
import { isBundledPlugin, pluginScopeHash } from "@/core/plugins/permission-policy";
import { pluginPermissionConsents } from "@/core/plugins/schema";
import type { Tx } from "@/core/service";

export async function seedReviewedBuiltinPlugins(tx: Tx, approvedBy: string): Promise<void> {
  for (const manifest of manifests) {
    if (!isPluginManifest(manifest) || !isBundledPlugin(manifest.name)) continue;
    await tx.insert(pluginPermissionConsents).values({ name: manifest.name, permissions: manifest.permissions, scopeHash: pluginScopeHash(manifest.name, manifest.permissions), reviewedVersion: manifest.version, approvedBy });
  }
}
