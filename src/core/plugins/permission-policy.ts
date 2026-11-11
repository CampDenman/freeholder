// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.40: owner approval is bound to the exact current declared scope set.
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { parsePermission } from "@freeholder/plugin-kit";
import { db } from "@/core/db";
import { ServiceError, type Tx } from "@/core/service";
import { env } from "@/core/env";
import { currentServiceTransaction, listPluginExecutions, pluginFailedAtBoot, type PluginExecution } from "./context";
import { installedPlugins, pluginPermissionConsents } from "./schema";

// These plugins are part of the platform release and its signing/provenance
// boundary. Local compiled extensions still require a signed registration.
const BUNDLED_PLUGINS = new Set(["proof", "gift-registry", "print-on-demand", "community", "voice-video", "marketplace"]);
export const isBundledPlugin = (name: string): boolean => BUNDLED_PLUGINS.has(name);
export const validConsentOrigin = (approvedBy: string): boolean => !approvedBy.startsWith("demo:") || env().FREEHOLDER_PLAYGROUND === "1";

export function pluginPermissions(value: unknown): string[] {
  const parsed = z.array(z.string()).safeParse(value);
  if (!parsed.success) throw new ServiceError("validation", "That plugin has no valid declared permission list.");
  try { for (const permission of parsed.data) parsePermission(permission); }
  catch { throw new ServiceError("validation", "That plugin has an invalid declared permission."); }
  return [...new Set(parsed.data)].sort();
}

export function pluginScopeHash(name: string, permissions: unknown): string {
  return createHash("sha256").update(`freeholder-plugin-permissions/v1\n${name}\n${JSON.stringify(pluginPermissions(permissions))}`).digest("hex");
}

export async function pluginReviewTarget(tx: Tx, name: string) {
  const [installed] = await tx.select().from(installedPlugins).where(eq(installedPlugins.name, name)).limit(1);
  const loaded = listPluginExecutions().find(plugin => plugin.name === name);
  if (!installed && (!loaded || !BUNDLED_PLUGINS.has(name))) throw new ServiceError("not_found", "Install this plugin's signed artifact before reviewing its permissions.");
  const version = installed?.version ?? loaded!.version;
  const permissions = pluginPermissions(installed?.permissions ?? loaded!.permissions);
  return { name, version, permissions, scopeHash: pluginScopeHash(name, permissions), installed, loaded };
}

export async function assertPluginConsent(tx: Tx, name: string, permissions: unknown): Promise<void> {
  const [consent] = await tx.select().from(pluginPermissionConsents).where(eq(pluginPermissionConsents.name, name)).limit(1);
  if (!consent || !validConsentOrigin(consent.approvedBy) || consent.revokedAt || consent.runtimeDisabledAt || consent.scopeHash !== pluginScopeHash(name, permissions)) {
    throw new ServiceError("permission", "The owner must review and approve this plugin's current permissions before enabling it.");
  }
}

export async function assertPluginCanRun(plugin: PluginExecution, inherited?: Tx): Promise<void> {
  if (pluginFailedAtBoot(plugin.name)) throw new ServiceError("permission", "This plugin could not load. Fix its installation and restart before enabling it.");
  const check = async (tx: Tx) => {
    await assertPluginConsent(tx, plugin.name, plugin.permissions);
    const [installed] = await tx.select().from(installedPlugins).where(eq(installedPlugins.name, plugin.name)).limit(1);
    if (!installed && !BUNDLED_PLUGINS.has(plugin.name)) throw new ServiceError("permission", "This plugin needs a signed installation before it can run.");
    if (installed?.status !== undefined && installed.status !== "enabled") throw new ServiceError("permission", "This plugin is disabled.");
    if (installed && pluginScopeHash(plugin.name, installed.permissions) !== pluginScopeHash(plugin.name, plugin.permissions)) {
      throw new ServiceError("conflict", "Rebuild with the reviewed plugin manifest before running it.");
    }
  };
  const current = inherited ?? currentServiceTransaction();
  if (current) await check(current);
  else await db().transaction(check);
}
