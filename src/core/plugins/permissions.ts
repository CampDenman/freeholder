// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.40: interactive owner consent; API keys and plugins cannot approve grants.
import { eq, like, sql } from "drizzle-orm";
import { z } from "zod";
import { okResult } from "@/core/contract";
import { actorString, defineService, ServiceError } from "@/core/service";
import { env } from "@/core/env";
import { listPluginExecutions, pluginFailedAtBoot } from "./context";
import { isBundledPlugin, pluginPermissions, pluginReviewTarget, pluginScopeHash, validConsentOrigin } from "./permission-policy";
import { assertTrustedArtifact, lockPublisherTrust, requirePublisherReviewer } from "./publisher-keys";
import { installedPlugins, pluginPermissionConsents } from "./schema";

export const listPluginPermissions = defineService({
  name: "plugins.listPermissions", summary: "Declared plugin scopes and the owner's current consent.", kind: "query", permission: "scoped", input: z.object({}),
  output: z.array(z.object({ name: z.string(), version: z.string(), permissions: z.array(z.string()), scopeHash: z.string(), bundled: z.boolean(), installed: z.boolean(), approved: z.boolean(), disabled: z.boolean(), bootDisabled: z.boolean() })),
  handler: async (_input, ctx) => {
    const installed = await ctx.tx.select().from(installedPlugins);
    const consents = await ctx.tx.select().from(pluginPermissionConsents);
    const names = new Set([...listPluginExecutions().filter(plugin => isBundledPlugin(plugin.name)).map(plugin => plugin.name), ...installed.map(plugin => plugin.name)]);
    return Promise.all([...names].sort().map(async name => {
      const target = await pluginReviewTarget(ctx.tx, name);
      const consent = consents.find(row => row.name === name);
      return { name, version: target.version, permissions: target.permissions, scopeHash: target.scopeHash, bundled: isBundledPlugin(name), installed: Boolean(target.installed), approved: Boolean(consent && validConsentOrigin(consent.approvedBy) && !consent.revokedAt && consent.scopeHash === target.scopeHash), disabled: Boolean(pluginFailedAtBoot(name) || consent?.runtimeDisabledAt || target.installed?.status === "disabled"), bootDisabled: pluginFailedAtBoot(name) };
    }));
  },
});

export const approvePluginPermissions = defineService({
  name: "plugins.approvePermissions", summary: "Approve an exact declared permission set after owner review.", kind: "mutation", permission: "scoped", agentCallable: false, stepUp: true,
  input: z.object({ name: z.string().min(1).max(120), scopeHash: z.string().regex(/^[a-f0-9]{64}$/), confirmation: z.literal(true) }), output: okResult,
  handler: async (input, ctx) => {
    requirePublisherReviewer(ctx.actor);
    await lockPublisherTrust(ctx.tx);
    const target = await pluginReviewTarget(ctx.tx, input.name);
    if (pluginFailedAtBoot(input.name)) throw new ServiceError("conflict", "Fix this plugin's installation and restart before reviewing its permissions.");
    if (target.scopeHash !== input.scopeHash) throw new ServiceError("conflict", "The permission list changed. Review the current list before approving it.");
    if (target.installed) {
      if (!target.installed.signature) throw new ServiceError("permission", "Verify this artifact's publisher signature before approving its permissions.");
      await assertTrustedArtifact(ctx.tx, target.installed.integrity, target.installed.signature);
    }
    const consent = { scopeHash: target.scopeHash, permissions: target.permissions, reviewedVersion: target.version, approvedBy: actorString(ctx.actor), approvedAt: sql`now()`, revokedAt: null, runtimeDisabledAt: null, disabledReason: null };
    await ctx.tx.insert(pluginPermissionConsents).values({ name: input.name, ...consent }).onConflictDoUpdate({ target: pluginPermissionConsents.name, set: consent });
    ctx.setSubject("plugin", input.name);
    ctx.queueEvent("plugin.permissionsApproved", { name: input.name, scopeHash: input.scopeHash });
    return { ok: true as const };
  },
});

export const revokePluginPermissions = defineService({
  name: "plugins.revokePermissions", summary: "Revoke a plugin's permissions and disable its contributions.", kind: "mutation", permission: "scoped", agentCallable: false, stepUp: true, writeClass: "destructive",
  input: z.object({ name: z.string().min(1).max(120), confirmation: z.literal(true) }), output: okResult,
  handler: async (input, ctx) => {
    requirePublisherReviewer(ctx.actor); await lockPublisherTrust(ctx.tx);
    const target = await pluginReviewTarget(ctx.tx, input.name);
    await ctx.tx.insert(pluginPermissionConsents).values({ name: input.name, scopeHash: target.scopeHash, permissions: pluginPermissions(target.permissions), reviewedVersion: target.version, approvedBy: actorString(ctx.actor), revokedAt: sql`now()` })
      .onConflictDoUpdate({ target: pluginPermissionConsents.name, set: { revokedAt: sql`now()` } });
    await ctx.tx.update(installedPlugins).set({ status: "disabled", disabledReason: "The owner revoked this plugin's permissions." }).where(eq(installedPlugins.name, input.name));
    ctx.setSubject("plugin", input.name); ctx.queueEvent("plugin.permissionsRevoked", { name: input.name });
    return { ok: true as const };
  },
});

export const reportPluginFailure = defineService({
  name: "plugins.reportRuntimeFailure", summary: "Disable a plugin after an unexpected runtime failure.", kind: "mutation", permission: "system", external: false,
  input: z.object({ name: z.string().min(1).max(120) }), output: okResult,
  handler: async (input, ctx) => {
    await lockPublisherTrust(ctx.tx);
    const target = await pluginReviewTarget(ctx.tx, input.name);
    const disabledReason = "This plugin stopped after an unexpected runtime error. Review it before enabling it again.";
    await ctx.tx.insert(pluginPermissionConsents).values({ name: input.name, scopeHash: pluginScopeHash(input.name, target.permissions), permissions: target.permissions, reviewedVersion: target.version, approvedBy: "system:runtime-failure", runtimeDisabledAt: sql`now()`, disabledReason })
      .onConflictDoUpdate({ target: pluginPermissionConsents.name, set: { runtimeDisabledAt: sql`now()`, disabledReason } });
    await ctx.tx.update(installedPlugins).set({ status: "disabled", disabledReason }).where(eq(installedPlugins.name, input.name));
    ctx.setSubject("plugin", input.name); ctx.queueEvent("plugin.runtimeDisabled", { name: input.name });
    return { ok: true as const };
  },
});

/** Synthetic playground state cannot establish permission consent on a real site. */
export const seedDemoPluginPermissions = defineService({
  name: "plugins.seedDemoPermissions", summary: "Seed synthetic bundled-plugin approvals only in the public playground.", kind: "mutation", permission: "system", external: false, input: z.object({}), output: okResult,
  handler: async (_input, ctx) => {
    if (env().FREEHOLDER_PLAYGROUND !== "1") throw new ServiceError("permission", "Synthetic plugin approval is limited to the public playground.");
    await lockPublisherTrust(ctx.tx);
    for (const plugin of listPluginExecutions().filter(item => isBundledPlugin(item.name))) {
      const consent = { scopeHash: pluginScopeHash(plugin.name, plugin.permissions), permissions: [...plugin.permissions], reviewedVersion: plugin.version, approvedBy: "demo:bundled-fixture", approvedAt: sql`now()`, revokedAt: null, runtimeDisabledAt: null, disabledReason: null };
      await ctx.tx.insert(pluginPermissionConsents).values({ name: plugin.name, ...consent }).onConflictDoUpdate({ target: pluginPermissionConsents.name, set: consent, setWhere: like(pluginPermissionConsents.approvedBy, "demo:%") });
    }
    ctx.setSubject("plugin", "playground-fixture");
    return { ok: true as const };
  },
});

export default [listPluginPermissions, approvePluginPermissions, revokePluginPermissions, reportPluginFailure, seedDemoPluginPermissions];
