// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Plugin install, enable, disable, update, uninstall (C3.09–C3.11).
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";
import { listed, okResult, row, timestamp, uuid } from "@/core/contract";
import { actorString, defineService, ServiceError } from "@/core/service";
import {
  assertPluginFitsInstance,
} from "@/core/plugin";
import { PLATFORM_VERSION } from "@/core/platform";
import { validatePluginContract, type PluginContractInput } from "@freeholder/plugin-kit";
import { installedPlugins, pluginPermissionConsents, pluginPublisherKeys, pluginRegistries, pluginRetentions } from "./schema";
import permissionServices from "./permissions";
import { assertPluginConsent, pluginScopeHash } from "./permission-policy";
import { assertDirectory, hashDirectory, signatureKeyId } from "./integrity";
import publisherKeyServices, { assertTrustedArtifact, lockPublisherTrust, publisherKeyId, requirePublisherReviewer, trustedPublisherKey } from "./publisher-keys";
import {
  parseRegistryIndex,
  registryIndexSchema,
  verifyRegistryIndex,
  type RegistryIndex,
} from "./registry";
import { assertPublicHttpUrl } from "@/core/import/contract";

const signatureInput = z.string().min(1).max(256);
const registryUrl = z.string().url().transform(value => new URL(value).href);
const artifactSnapshot = z.object({
  version: z.string(), source: z.string(), integrity: z.string(), signature: z.string().nullable(),
  license: z.string(), freeholder: z.string(), permissions: z.array(z.string()),
});

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
  try {
    await assertDirectory(dir);
    const path = join(/* turbopackIgnore: true */ dir, "plugin.json");
    const info = await lstat(/* turbopackIgnore: true */ path);
    if (!info.isFile() || info.size > 64 * 1024) throw new Error("manifest-type-or-size");
    const raw = JSON.parse(await readFile(/* turbopackIgnore: true */ path, "utf8")) as PluginContractInput;
    validatePluginContract(raw);
    return raw;
  } catch {
    // JSON parse errors can echo file contents. Neither malformed manifests
    // nor links to unrelated files may turn into a disclosure through HTTP.
    throw new ServiceError("validation", "That plugin.json is unavailable or invalid. Use a regular file in the plugin folder.");
  }
}

async function artifactIntegrity(path: string): Promise<string> {
  try { return await hashDirectory(path); } catch {
    throw new ServiceError("validation", "That artifact cannot be verified. Use a readable folder of regular files without symbolic links.");
  }
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
    signature: signatureInput,
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
    const integrity = await artifactIntegrity(input.path);
    if (input.expectedIntegrity && input.expectedIntegrity !== integrity) {
      throw new ServiceError(
        "conflict",
        `Integrity mismatch for ${manifest.name}. Check the publisher's artifact hash.`,
      );
    }
    await lockPublisherTrust(ctx.tx);
    await assertTrustedArtifact(ctx.tx, integrity, input.signature);
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
        signature: input.signature,
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
    await lockPublisherTrust(ctx.tx);
    const [stored] = await ctx.tx.select().from(installedPlugins).where(eq(installedPlugins.name, input.name)).limit(1);
    if (!stored) throw new ServiceError("not_found", `No plugin named ${input.name}.`);
    const integrity = await artifactIntegrity(stored.source);
    if (integrity !== stored.integrity) throw new ServiceError("conflict", "The installed plugin files changed. Verify an update before enabling them.");
    if (!stored.signature) throw new ServiceError("permission", "This plugin needs a trusted Ed25519 signature before it can be enabled.");
    await assertTrustedArtifact(ctx.tx, integrity, stored.signature);
    await assertPluginConsent(ctx.tx, stored.name, stored.permissions);
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
    await lockPublisherTrust(ctx.tx);
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
    signature: signatureInput,
  }),
  output: pluginRow,
  handler: async (input, ctx) => {
    const manifest = await readManifest(input.path);
    await lockPublisherTrust(ctx.tx);
    const [before] = await ctx.tx
      .select()
      .from(installedPlugins)
      .where(eq(installedPlugins.name, manifest.name))
      .limit(1);
    if (!before) throw new ServiceError("not_found", `${manifest.name} is not installed.`);
    const integrity = await artifactIntegrity(input.path);
    if (input.expectedIntegrity && input.expectedIntegrity !== integrity) {
      throw new ServiceError("conflict", `Integrity mismatch for ${manifest.name}.`);
    }
    const publisher = await assertTrustedArtifact(ctx.tx, integrity, input.signature);
    const previousKeyId = before.signature ? signatureKeyId(before.signature) : null;
    const [previousKey] = previousKeyId ? await ctx.tx.select().from(pluginPublisherKeys).where(eq(pluginPublisherKeys.keyId, previousKeyId)).limit(1) : [];
    if (!previousKey) requirePublisherReviewer(ctx.actor);
    else if (previousKey.publisher !== publisher.publisher) throw new ServiceError("permission", "This update uses a different publisher. Review a separate installation instead.");
    const replacement = artifactSnapshot.parse({ ...manifest, source: input.path, integrity, signature: input.signature, permissions: manifest.permissions ?? [] });
    // A lost response followed by an identical retry must preserve the real
    // rollback artifact, rather than replacing it with the current version.
    if (JSON.stringify(artifactSnapshot.parse(before)) === JSON.stringify(replacement)) {
      ctx.setSubject("plugin", before.id);
      return before;
    }
    const scopesChanged = pluginScopeHash(before.name, before.permissions) !== pluginScopeHash(before.name, manifest.permissions ?? []);
    if (scopesChanged) await ctx.tx.update(pluginPermissionConsents).set({ revokedAt: new Date() }).where(eq(pluginPermissionConsents.name, before.name));
    const [row] = await ctx.tx
      .update(installedPlugins)
      .set({
        version: manifest.version,
        source: input.path,
        integrity,
        signature: input.signature,
        previousVersion: before.version,
        previousArtifact: artifactSnapshot.parse(before),
        license: manifest.license,
        freeholder: manifest.freeholder,
        permissions: manifest.permissions ?? [],
        ...(scopesChanged ? { status: "disabled" as const, disabledReason: "Review and approve this plugin's changed permissions before enabling it." } : {}),
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
    await lockPublisherTrust(ctx.tx);
    const [before] = await ctx.tx
      .select()
      .from(installedPlugins)
      .where(eq(installedPlugins.name, input.name))
      .limit(1);
    if (!before) throw new ServiceError("not_found", `No plugin named ${input.name}.`);
    const previous = artifactSnapshot.safeParse(before.previousArtifact);
    if (!before.previousVersion || !previous.success) {
      throw new ServiceError("conflict", `${input.name} has no previous version to restore.`);
    }
    const artifact = previous.data;
    const manifest = await readManifest(artifact.source);
    const integrity = await artifactIntegrity(artifact.source);
    if (manifest.name !== input.name || manifest.version !== artifact.version || integrity !== artifact.integrity) {
      throw new ServiceError("conflict", "The previous artifact is unavailable or changed. Install a verified copy instead.");
    }
    if (!artifact.signature) throw new ServiceError("permission", "A plugin cannot roll back to an unsigned artifact.");
    await assertTrustedArtifact(ctx.tx, integrity, artifact.signature);
    const scopesChanged = pluginScopeHash(before.name, before.permissions) !== pluginScopeHash(before.name, artifact.permissions);
    if (scopesChanged) await ctx.tx.update(pluginPermissionConsents).set({ revokedAt: new Date() }).where(eq(pluginPermissionConsents.name, before.name));
    const [row] = await ctx.tx
      .update(installedPlugins)
      .set({ ...artifact, previousVersion: before.version, previousArtifact: artifactSnapshot.parse(before), ...(scopesChanged ? { status: "disabled" as const, disabledReason: "Review and approve this plugin's changed permissions before enabling it." } : {}) })
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
    await lockPublisherTrust(ctx.tx);
    await ctx.tx.update(pluginPermissionConsents).set({ revokedAt: new Date() }).where(eq(pluginPermissionConsents.name, input.name));
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
      publisherKeyId: publisherKeyId.nullable(),
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
    url: registryUrl,
    publisherKeyId: publisherKeyId.optional(),
    tier: z.enum(["verified", "community", "private", "local"]).default("community"),
  }),
  output: row({
    id: uuid,
    name: z.string(),
    url: z.string(),
    tier: z.enum(["verified", "community", "private", "local"]),
  }),
  handler: async (input, ctx) => {
    assertPublicHttpUrl(input.url);
    if (input.publisherKeyId) {
      requirePublisherReviewer(ctx.actor);
      await lockPublisherTrust(ctx.tx);
      await trustedPublisherKey(ctx.tx, input.publisherKeyId);
    }
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
    url: registryUrl,
    index: registryIndexSchema,
    signature: z.string().min(1).max(256),
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
    await lockPublisherTrust(ctx.tx);
    const [existing] = await ctx.tx
      .select()
      .from(pluginRegistries)
      .where(eq(pluginRegistries.url, input.url))
      .limit(1);
    if (!existing?.publisherKeyId) throw new ServiceError("permission", "The owner must pin this registry to a trusted publisher key before caching its catalog.");
    const key = await trustedPublisherKey(ctx.tx, existing.publisherKeyId);
    if (signatureKeyId(input.signature) !== key.keyId || !verifyRegistryIndex(index, input.url, input.signature, key.publicKey)) {
      throw new ServiceError("permission", "That registry signature does not match its pinned publisher key and URL.");
    }
    const values = {
      cachedIndex: index,
      signature: input.signature,
      fetchedAt: new Date().toISOString(),
    };
    const [row] = await ctx.tx
          .update(pluginRegistries)
          .set(values)
          .where(eq(pluginRegistries.id, existing.id))
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
    const keys = await ctx.tx.select().from(pluginPublisherKeys);
    const catalog = [];
    for (const registry of registries) {
      const parsed = registryIndexSchemaSafe(registry.cachedIndex);
      const key = keys.find(item => item.keyId === registry.publisherKeyId && !item.revokedAt);
      if (!parsed || !key || !registry.signature || !verifyRegistryIndex(parsed, registry.url, registry.signature, key.publicKey)) continue;
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
  ...publisherKeyServices,
  ...permissionServices,
];
