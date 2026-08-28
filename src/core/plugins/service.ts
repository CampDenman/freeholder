// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Plugin install, enable, disable, update, uninstall (C3.09â€“C3.11).
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { listed, okResult, row, timestamp, uuid } from "@/core/contract";
import { actorString, defineService, ServiceError } from "@/core/service";
import {
  assertPluginFitsInstance,
} from "@/core/plugin";
import { PLATFORM_VERSION } from "@/core/platform";
import { validatePluginContract, type PluginContractInput } from "@freeholder/plugin-kit";
import { installedPlugins, pluginRegistries, pluginRetentions } from "./schema";
import { assertDirectory, hashDirectory, verifySignature } from "./integrity";
import {
  parseRegistryIndex,
  verifyRegistryIndex,
  type RegistryIndex,
} from "./registry";
import { assertPublicHttpUrl } from "@/core/import/contract";

const pluginRow = row({
  id: uuid,
  name: z.string(),
  version: z.string(),
  status: z.enum(["installed", "enabled", "disabled"]),
  source: z.string(),
  tier: z.enum(["verified", "community", "private", "local"]),
  integrity: z.string(),
  signature: z.string().nullable(),
  license: z.string(),
  freeholder: z.string(),
  permissions: z.unknown(),
  config: z.unknown(),
  disabledReason: z.string().nullable(),
  previousVersion: z.string().nullable(),
  installedBy: z.string(),
  createdAt: timestamp,
  updatedAt: timestamp,
});

async function readManifest(dir: string): Promise<PluginContractInput> {
  // The directory is owner-supplied at runtime. Tracing it at build time makes
  // Turbopack conservatively copy the entire repository into standalone.
  const raw = JSON.parse(
    await readFile(
      join(/* turbopackIgnore: true */ dir, "plugin.json"),
      "utf8",
    ),
  ) as PluginContractInput;
  validatePluginContract(raw);
  return raw;
}

export const listInstalledPlugins = defineService({
  name: "plugins.list",
  summary: "Every plugin this instance has installed.",
  kind: "query",
  permission: "scoped",
  input: z.object({}),
  output: listed(pluginRow),
  handler: (input, ctx) =>
    ctx.tx.select().from(installedPlugins).orderBy(desc(installedPlugins.createdAt)),
});

export const getInstalledPlugin = defineService({
  name: "plugins.get",
  summary: "One installed plugin by name.",
  kind: "query",
  permission: "scoped",
  input: z.object({ name: z.string().min(1) }),
  output: pluginRow.nullable(),
  handler: async (input, ctx) => {
    const [row] = await ctx.tx
      .select()
      .from(installedPlugins)
      .where(eq(installedPlugins.name, input.name))
      .limit(1);
    return row ?? null;
  },
});

export const installPlugin = defineService({
  name: "plugins.install",
  summary: "Install a plugin from a local directory after checking integrity.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    path: z.string().min(1),
    expectedIntegrity: z.string().optional(),
    signature: z.string().optional(),
    signingSecret: z.string().optional(),
  }),
  output: pluginRow,
  handler: async (input, ctx) => {
    await assertDirectory(input.path).catch((error: unknown) => {
      throw new ServiceError(
        "not_found",
        error instanceof Error ? error.message : "That plugin path is gone.",
      );
    });
    let manifest;
    try {
      manifest = await readManifest(input.path);
    } catch (error) {
      throw new ServiceError(
        "validation",
        error instanceof Error ? error.message : "That plugin.json is not valid.",
      );
    }
    const installed = ["core", "cms", "invoicing", "catalog", "forms", "analytics"];
    try {
      assertPluginFitsInstance(
        {
          name: manifest.name,
          version: manifest.version,
          kind: "plugin",
          freeholder: manifest.freeholder,
          license: manifest.license,
          requires: manifest.requires,
          migrations: manifest.migrations ?? [],
        },
        { installed, platformVersion: PLATFORM_VERSION },
      );
    } catch (error) {
      throw new ServiceError(
        "conflict",
        error instanceof Error ? error.message : "That plugin does not fit this instance.",
      );
    }
    const integrity = await hashDirectory(input.path);
    if (input.expectedIntegrity && input.expectedIntegrity !== integrity) {
      throw new ServiceError(
        "conflict",
        `Integrity mismatch for ${manifest.name}: expected ${input.expectedIntegrity}, got ${integrity}.`,
      );
    }
    if (input.signature) {
      if (!input.signingSecret) {
        throw new ServiceError("validation", "A signature needs the signing secret to check.");
      }
      if (!verifySignature(integrity, input.signature, input.signingSecret)) {
        throw new ServiceError("permission", "That plugin signature does not match.");
      }
    }
    const [existing] = await ctx.tx
      .select({ id: installedPlugins.id })
      .from(installedPlugins)
      .where(eq(installedPlugins.name, manifest.name))
      .limit(1);
    if (existing) {
      throw new ServiceError("conflict", `${manifest.name} is already installed. Update it instead.`);
    }
    const [row] = await ctx.tx
      .insert(installedPlugins)
      .values({
        name: manifest.name,
        version: manifest.version,
        status: "installed",
        source: input.path,
        tier: "local",
        integrity,
        signature: input.signature ?? null,
        license: manifest.license,
        freeholder: manifest.freeholder,
        permissions: manifest.permissions ?? [],
        installedBy: actorString(ctx.actor),
      })
      .returning();
    ctx.setSubject("plugin", row!.id);
    ctx.queueEvent("plugin.installed", { name: row!.name, version: row!.version });
    return row!;
  },
});

export const enablePlugin = defineService({
  name: "plugins.enable",
  summary: "Turn an installed plugin on.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({ name: z.string().min(1) }),
  output: pluginRow,
  handler: async (input, ctx) => {
    const [row] = await ctx.tx
      .update(installedPlugins)
      .set({ status: "enabled", disabledReason: null })
      .where(eq(installedPlugins.name, input.name))
      .returning();
    if (!row) throw new ServiceError("not_found", `No plugin named ${input.name}.`);
    ctx.setSubject("plugin", row.id);
    ctx.queueEvent("plugin.enabled", { name: row.name });
    return row;
  },
});

export const disablePlugin = defineService({
  name: "plugins.disable",
  summary: "Turn a plugin off without uninstalling it.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({ name: z.string().min(1), reason: z.string().max(500).optional() }),
  output: pluginRow,
  handler: async (input, ctx) => {
    const [row] = await ctx.tx
      .update(installedPlugins)
      .set({ status: "disabled", disabledReason: input.reason ?? "Disabled by the owner." })
      .where(eq(installedPlugins.name, input.name))
      .returning();
    if (!row) throw new ServiceError("not_found", `No plugin named ${input.name}.`);
    ctx.setSubject("plugin", row.id);
    ctx.queueEvent("plugin.disabled", { name: row.name });
    return row;
  },
});

export const updatePlugin = defineService({
  name: "plugins.update",
  summary: "Replace an installed plugin with a newer directory, keeping a rollback version.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    path: z.string().min(1),
    expectedIntegrity: z.string().optional(),
  }),
  output: pluginRow,
  handler: async (input, ctx) => {
    const manifest = await readManifest(input.path);
    const [before] = await ctx.tx
      .select()
      .from(installedPlugins)
      .where(eq(installedPlugins.name, manifest.name))
      .limit(1);
    if (!before) throw new ServiceError("not_found", `${manifest.name} is not installed.`);
    const integrity = await hashDirectory(input.path);
    if (input.expectedIntegrity && input.expectedIntegrity !== integrity) {
      throw new ServiceError("conflict", `Integrity mismatch for ${manifest.name}.`);
    }
    const [row] = await ctx.tx
      .update(installedPlugins)
      .set({
        version: manifest.version,
        source: input.path,
        integrity,
        previousVersion: before.version,
        license: manifest.license,
        freeholder: manifest.freeholder,
        permissions: manifest.permissions ?? [],
      })
      .where(eq(installedPlugins.id, before.id))
      .returning();
    ctx.setSubject("plugin", row!.id);
    ctx.queueEvent("plugin.updated", { name: row!.name, version: row!.version });
    return row!;
  },
});

export const rollbackPlugin = defineService({
  name: "plugins.rollback",
  summary: "Restore the version recorded before the last update.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({ name: z.string().min(1) }),
  output: pluginRow,
  handler: async (input, ctx) => {
    const [before] = await ctx.tx
      .select()
      .from(installedPlugins)
      .where(eq(installedPlugins.name, input.name))
      .limit(1);
    if (!before) throw new ServiceError("not_found", `No plugin named ${input.name}.`);
    if (!before.previousVersion) {
      throw new ServiceError("conflict", `${input.name} has no previous version to restore.`);
    }
    const [row] = await ctx.tx
      .update(installedPlugins)
      .set({ version: before.previousVersion, previousVersion: before.version })
      .where(eq(installedPlugins.id, before.id))
      .returning();
    ctx.setSubject("plugin", row!.id);
    ctx.queueEvent("plugin.rolledBack", { name: row!.name, version: row!.version });
    return row!;
  },
});

export const uninstallPlugin = defineService({
  name: "plugins.uninstall",
  writeClass: "destructive",
  summary: "Remove a plugin. keep leaves its data; purge asks doctor to drop it later.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    name: z.string().min(1),
    retention: z.enum(["keep", "purge"]),
  }),
  output: okResult.extend({ name: z.string(), retention: z.enum(["keep", "purge"]) }),
  handler: async (input, ctx) => {
    const [row] = await ctx.tx
      .delete(installedPlugins)
      .where(eq(installedPlugins.name, input.name))
      .returning({ id: installedPlugins.id, name: installedPlugins.name });
    if (!row) throw new ServiceError("not_found", `No plugin named ${input.name}.`);
    await ctx.tx
      .insert(pluginRetentions)
      .values({ name: row.name, retention: input.retention })
      .onConflictDoUpdate({
        target: pluginRetentions.name,
        set: { retention: input.retention },
      });
    ctx.setSubject("plugin", row.id);
    ctx.queueEvent("plugin.uninstalled", { name: row.name, retention: input.retention });
    return { ok: true as const, name: row.name, retention: input.retention };
  },
});

export const listPluginRegistries = defineService({
  name: "plugins.listRegistries",
  summary: "Configured plugin registries for this instance.",
  kind: "query",
  permission: "scoped",
  input: z.object({}),
  output: listed(
    row({
      id: uuid,
      name: z.string(),
      url: z.string(),
      tier: z.enum(["verified", "community", "private", "local"]),
      signature: z.string().nullable(),
      cachedIndex: z.unknown(),
      fetchedAt: z.string().nullable(),
      createdAt: timestamp,
      updatedAt: timestamp,
    }),
  ),
  handler: (input, ctx) =>
    ctx.tx.select().from(pluginRegistries).orderBy(pluginRegistries.name),
});

export const addPluginRegistry = defineService({
  name: "plugins.addRegistry",
  summary: "Point this instance at another plugin registry.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    name: z.string().min(1).max(80),
    url: z.string().url(),
    tier: z.enum(["verified", "community", "private", "local"]).default("community"),
  }),
  output: row({
    id: uuid,
    name: z.string(),
    url: z.string(),
    tier: z.enum(["verified", "community", "private", "local"]),
  }),
  handler: async (input, ctx) => {
    const [row] = await ctx.tx
      .insert(pluginRegistries)
      .values(input)
      .returning();
    ctx.setSubject("plugin_registry", row!.id);
    ctx.queueEvent("plugin.registryAdded", { url: row!.url });
    return row!;
  },
});

const catalogPlugin = row({
  name: z.string(),
  version: z.string(),
  tier: z.enum(["verified", "community", "private", "local"]),
  license: z.string(),
  permissions: z.unknown(),
  freeholder: z.string(),
  integrity: z.string(),
  changelog: z.string(),
});

export const cachePluginRegistry = defineService({
  name: "plugins.cacheRegistry",
  summary: "Store a signed registry index after verifying its signature.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    url: z.string().url(),
    index: z.unknown(),
    signature: z.string().min(1),
    signingSecret: z.string().min(1),
  }),
  output: row({
    id: uuid,
    name: z.string(),
    url: z.string(),
    plugins: z.number(),
  }),
  handler: async (input, ctx) => {
    assertPublicHttpUrl(input.url);
    const index = parseRegistryIndex(input.index);
    if (!verifyRegistryIndex(index, input.signature, input.signingSecret)) {
      throw new ServiceError("permission", "That registry signature does not match.");
    }
    const [existing] = await ctx.tx
      .select()
      .from(pluginRegistries)
      .where(eq(pluginRegistries.url, input.url))
      .limit(1);
    const values = {
      cachedIndex: index,
      signature: input.signature,
      fetchedAt: new Date().toISOString(),
    };
    const [row] = existing
      ? await ctx.tx
          .update(pluginRegistries)
          .set(values)
          .where(eq(pluginRegistries.id, existing.id))
          .returning()
      : await ctx.tx
          .insert(pluginRegistries)
          .values({
            name: index.registry,
            url: input.url,
            tier: "community",
            ...values,
          })
          .returning();
    ctx.setSubject("plugin_registry", row!.id);
    ctx.queueEvent("plugin.registryCached", { url: row!.url });
    return { id: row!.id, name: row!.name, url: row!.url, plugins: index.plugins.length };
  },
});

export const listPluginCatalog = defineService({
  name: "plugins.listCatalog",
  summary: "Cached plugins from every configured registry.",
  kind: "query",
  permission: "scoped",
  input: z.object({}),
  output: listed(catalogPlugin),
  handler: async (_input, ctx) => {
    const registries = await ctx.tx.select().from(pluginRegistries);
    const catalog = [];
    for (const registry of registries) {
      const parsed = registryIndexSchemaSafe(registry.cachedIndex);
      if (!parsed) continue;
      catalog.push(...parsed.plugins);
    }
    return catalog;
  },
});

function registryIndexSchemaSafe(value: unknown): RegistryIndex | null {
  try {
    return parseRegistryIndex(value);
  } catch {
    return null;
  }
}

export default [
  listInstalledPlugins,
  getInstalledPlugin,
  installPlugin,
  enablePlugin,
  disablePlugin,
  updatePlugin,
  rollbackPlugin,
  uninstallPlugin,
  listPluginRegistries,
  addPluginRegistry,
  cachePluginRegistry,
  listPluginCatalog,
];
