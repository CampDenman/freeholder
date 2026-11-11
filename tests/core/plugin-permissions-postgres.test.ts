// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/core/db";
import { checkPlugins } from "@/core/doctor";
import { contacts } from "@/core/contacts/schema";
import { resolveContact } from "@/core/contacts/service";
import { auditLog, outboxEventDeliveries, outboxEvents } from "@/core/events/schema";
import { subscribe } from "@/core/events";
import { enqueue, redeliverOutboxEvent, replayOutboxEvent } from "@/core/events/outbox";
import { actorString, defineService, getService, type Actor } from "@/core/service";
import { ready } from "@/core/runtime";
import { bindPluginService, registerPluginExecution } from "@/core/plugins/context";
import { approvePluginPermissions, revokePluginPermissions, seedDemoPluginPermissions } from "@/core/plugins/permissions";
import { pluginJob, pluginListener } from "@/core/plugins/runtime";
import { resetEnvForTests } from "@/core/env";
import { pluginScopeHash } from "@/core/plugins/permission-policy";
import { installedPlugins, pluginPermissionConsents } from "@/core/plugins/schema";
import { enablePlugin, installPlugin, updatePlugin } from "@/core/plugins/service";
import { hashDirectory, publisherPublicKey, signIntegrity } from "@/core/plugins/integrity";
import { revokePublisherKey, trustPublisherKey } from "@/core/plugins/publisher-keys";
import { completeErasureJob } from "@/core/privacy/service";
import { ANONYMOUS, closeDb, failure, hasDatabase, OWNER, STAFF, truncateSpine } from "../helpers/spine";

const signer = generateKeyPairSync("ed25519");
const publicKey = signer.publicKey.export({ type: "spki", format: "pem" }).toString();
const keyId = publisherPublicKey(publicKey).keyId;
const reviewer = { ...OWNER, security: { twoFactorRequired: true, twoFactorEnrolled: true, twoFactorVerified: true, stepUpValid: true } };
const reader = registerPluginExecution({ name: "runtime-fixture", version: "0.1.0", permissions: ["contacts:read"] });
const writer = registerPluginExecution({ name: "write-fixture", version: "0.1.0", permissions: ["contacts:write"] });
const directories: string[] = [];

const identity = defineService({
  name: "contacts.pluginIdentityFixture", summary: "Inspect fixture composition identity.", kind: "query", permission: "scoped", input: z.object({}), output: z.object({ actor: z.string(), txId: z.string() }),
  handler: async (_input, ctx) => {
    const rows = await ctx.tx.execute(sql`select txid_current()::text as id`);
    return { actor: actorString(ctx.actor), txId: String(rows[0]?.id) };
  },
});
const read = defineService({
  name: "runtimeFixture.read", summary: "Read through the fixture plugin.", kind: "query", permission: "scoped", input: z.object({}), output: z.object({ actor: z.string(), sameTransaction: z.boolean() }),
  handler: async (_input, ctx) => {
    const rows = await ctx.tx.execute(sql`select txid_current()::text as id`);
    const result = await ctx.call(identity, {});
    return { actor: result.actor, sameTransaction: result.txId === String(rows[0]?.id) };
  },
});
const escape = defineService({
  name: "runtimeFixture.escape", summary: "Attempt a fixture privilege escalation.", kind: "mutation", permission: "scoped", input: z.object({}), output: z.boolean(),
  handler: async (_input, ctx) => { await ctx.callAsSystem(resolveContact, { email: "unapproved@example.test", source: "plugin" }); return true; },
});
const forgeCoreWork = defineService({
  name: "runtimeFixture.forge", summary: "Attempt a plugin event/job identity escape.", kind: "mutation", permission: "scoped", input: z.object({ seam: z.enum(["event", "timeline", "job"]) }), output: z.boolean(),
  handler: async ({ seam }, ctx) => {
    if (seam === "event") ctx.queueEvent("invoice.paid", { fixture: true });
    if (seam === "timeline") await ctx.emitTimeline({ contactId: "00000000-0000-4000-8000-000000000001", eventType: "contact.updated", subjectType: "contact" });
    if (seam === "job") await ctx.queueJob("core.deadLetter", {});
    return true;
  },
});
const broken = defineService({
  name: "writeFixture.broken", summary: "Fail after a composed contact resolution.", kind: "mutation", permission: "scoped", input: z.object({}), output: z.boolean(),
  handler: async (_input, ctx) => { await ctx.call(resolveContact, { email: "rollback@example.test", source: "plugin" }); throw new Error("PRIVATE_RUNTIME_MARKER"); },
});
const healthy = defineService({
  name: "writeFixture.healthy", summary: "Resolve a fixture contact.", kind: "mutation", permission: "scoped", input: z.object({}), output: z.string(),
  handler: async (_input, ctx) => (await ctx.call(resolveContact, { email: "recovered@example.test", source: "plugin" })).contact.id,
});
const catchesBroken = defineService({
  name: "core.pluginFailureFixture", summary: "A core parent attempts to recover a broken plugin call.", kind: "mutation", permission: "scoped", input: z.object({}), output: z.boolean(),
  handler: async (_input, ctx) => { try { await ctx.call(broken, {}); } catch { /* The kernel must still roll back. */ } return true; },
});
for (const service of [read, escape, forgeCoreWork]) bindPluginService(service.def, reader);
for (const service of [broken, healthy]) bindPluginService(service.def, writer);

async function artifact(name = reader.name, permissions = [...reader.permissions], version = "0.1.0") {
  const path = await mkdtemp(join(tmpdir(), "freeholder-permission-fixture-")); directories.push(path);
  await writeFile(join(path, "plugin.json"), JSON.stringify({ name, version, license: "Apache-2.0", freeholder: ">=0.0.0", permissions, requires: ["core"] }));
  await writeFile(join(path, "index.js"), "// Compiled fixture contribution");
  const expectedIntegrity = await hashDirectory(path);
  return { path, expectedIntegrity, signature: signIntegrity(expectedIntegrity, signer.privateKey) };
}
const approval = (name = reader.name, permissions: readonly string[] = reader.permissions) => ({ name, scopeHash: pluginScopeHash(name, permissions), confirmation: true as const });
async function installApproved(plugin = reader) {
  await installPlugin.call(await artifact(plugin.name, [...plugin.permissions]), OWNER);
  await approvePluginPermissions.call(approval(plugin.name, plugin.permissions), reviewer);
  await enablePlugin.call({ name: plugin.name }, OWNER);
}

describe.runIf(hasDatabase)("owner-reviewed plugin execution (C3.40)", { timeout: 30_000 }, () => {
  beforeEach(async () => {
    await ready(); await truncateSpine();
    await trustPublisherKey.call({ publisher: "Permission fixture", publicKey, fingerprint: keyId, confirmation: true }, reviewer);
  });
  afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { force: true, recursive: true }))); });
  afterAll(closeDb);

  it("requires a fresh signed-in owner and exact confirmed scopes before enable", async () => {
    await installPlugin.call(await artifact(), OWNER);
    expect(await failure(enablePlugin.call({ name: reader.name }, OWNER))).toMatchObject({ code: "permission" });
    const refused: Actor[] = [ANONYMOUS, STAFF, { kind: "system" }, { kind: "agent", keyName: "plugin-review", scopes: ["plugins.*"] }, { ...reviewer, keyScopes: ["plugins.*"] }];
    for (const actor of refused) expect(await failure(approvePluginPermissions.call(approval(), actor))).toMatchObject({ code: "permission" });
    expect(await failure(approvePluginPermissions.call(approval(), OWNER))).toMatchObject({ code: "step_up_required" });
    expect(await failure(approvePluginPermissions.call({ ...approval(), confirmation: false }, reviewer))).toMatchObject({ code: "validation" });
    expect(await failure(approvePluginPermissions.call({ ...approval(), scopeHash: "0".repeat(64) }, reviewer))).toMatchObject({ code: "conflict" });
    expect(await db().select().from(pluginPermissionConsents).where(eq(pluginPermissionConsents.name, reader.name))).toHaveLength(0);
    await approvePluginPermissions.call({ ...approval(), permissions: ["invoicing:write"] }, reviewer);
    expect((await db().select().from(pluginPermissionConsents).where(eq(pluginPermissionConsents.name, reader.name)))[0]!.permissions).toEqual(["contacts:read"]);
    await enablePlugin.call({ name: reader.name }, OWNER);
  });

  it("uses the declared actor and parent's transaction, while rejecting forged system elevation", async () => {
    await installApproved();
    const agent: Actor = { kind: "agent", keyName: "fixture-reader", scopes: ["runtimeFixture.*"] };
    expect(await read.call({}, agent)).toEqual({ actor: "plugin:runtime-fixture", sameTransaction: true });
    expect(await failure(escape.call({}, OWNER))).toMatchObject({ code: "permission" });
    expect(await db().select().from(contacts).where(eq(contacts.email, "unapproved@example.test"))).toHaveLength(0);
  });

  it("cannot forge core event/timeline identities or enqueue a core job through its context", async () => {
    await installApproved();
    for (const seam of ["event", "timeline", "job"] as const) expect(await failure(forgeCoreWork.call({ seam }, OWNER))).toMatchObject({ code: "permission" });
    expect(await db().select().from(outboxEvents).where(eq(outboxEvents.eventName, "invoice.paid"))).toHaveLength(0);
    expect((await db().select().from(pluginPermissionConsents).where(eq(pluginPermissionConsents.name, reader.name)))[0]!.runtimeDisabledAt).toBeNull();
  });

  it("rolls back unexpected nested failures even if the parent catches, then permits reviewed recovery", async () => {
    await installApproved(writer);
    expect(await failure(catchesBroken.call({}, OWNER))).toMatchObject({ code: "internal" });
    expect(await db().select().from(contacts).where(eq(contacts.email, "rollback@example.test"))).toHaveLength(0);
    const [consent] = await db().select().from(pluginPermissionConsents).where(eq(pluginPermissionConsents.name, writer.name));
    expect(consent!.runtimeDisabledAt).not.toBeNull(); expect(consent!.disabledReason).not.toContain("PRIVATE_RUNTIME_MARKER");
    expect(await checkPlugins()).toContainEqual(expect.objectContaining({ id: "plugins.permissions", verdict: "warn" }));
    expect(await failure(healthy.call({}, OWNER))).toMatchObject({ code: "permission" });
    await approvePluginPermissions.call(approval(writer.name, writer.permissions), reviewer);
    await enablePlugin.call({ name: writer.name }, OWNER);
    expect(await healthy.call({}, OWNER)).toMatch(/^[a-f0-9-]{36}$/);
    const rows = await db().select().from(auditLog).where(eq(auditLog.action, "contacts.resolve"));
    expect(rows).toHaveLength(1); expect(rows[0]!.actor).toBe("plugin:write-fixture");
  });

  it("invalidates consent when a signed update changes its permission set", async () => {
    await installApproved();
    const permissions = [...reader.permissions, "invoicing:write"];
    await updatePlugin.call(await artifact(reader.name, permissions, "0.2.0"), OWNER);
    expect((await db().select().from(installedPlugins).where(eq(installedPlugins.name, reader.name)))[0]!.status).toBe("disabled");
    expect(await failure(approvePluginPermissions.call(approval(), reviewer))).toMatchObject({ code: "conflict" });
    expect(await failure(enablePlugin.call({ name: reader.name }, OWNER))).toMatchObject({ code: "permission" });
    await approvePluginPermissions.call(approval(reader.name, permissions), reviewer);
    await enablePlugin.call({ name: reader.name }, OWNER);
    // The old compiled entry still carries old scopes and cannot run until
    // deployment actually loads the reviewed manifest.
    expect(await failure(read.call({}, OWNER))).toMatchObject({ code: "permission" });
  });

  it("stops future contributions after permission or publisher-key revocation", async () => {
    await installApproved();
    expect(await failure(revokePluginPermissions.call({ name: reader.name }, reviewer))).toMatchObject({ code: "validation" });
    await revokePluginPermissions.call({ name: reader.name, confirmation: true }, reviewer);
    expect(await failure(read.call({}, OWNER))).toMatchObject({ code: "permission" });
    await approvePluginPermissions.call(approval(), reviewer); await enablePlugin.call({ name: reader.name }, OWNER);
    await revokePublisherKey.call({ keyId, confirmation: true }, reviewer);
    expect(await failure(read.call({}, OWNER))).toMatchObject({ code: "permission" });
  });

  it("never lets a provider erasure acknowledgement claim another plugin's scope", async () => {
    const actor: Actor = { kind: "plugin", name: "voice-video", grants: [{ module: "privacy", access: "manage" }] };
    expect(await failure(completeErasureJob.call({ requestId: "00000000-0000-4000-8000-000000000010", jobId: "00000000-0000-4000-8000-000000000011", scope: "plugins.other-provider" }, actor))).toMatchObject({ code: "permission" });
  });

  it("does not acknowledge accepted jobs or events while their plugin is disabled", async () => {
    await installApproved();
    const handler = vi.fn(async () => {});
    const listenerId = "runtimeFixture:accepted:handler";
    subscribe("runtime.accepted", listenerId, pluginListener(reader, handler), reader);
    const eventId = await db().transaction(tx => enqueue(tx, "runtime.accepted", {}));
    await revokePluginPermissions.call({ name: reader.name, confirmation: true }, reviewer);
    const job = pluginJob(reader, { name: "runtimeFixture.accepted", summary: "Durable fixture task.", handler });
    await expect(job.handler({ acceptedTask: "fixture" })).rejects.toMatchObject({ code: "permission" });
    await redeliverOutboxEvent(eventId);
    const [pending] = await db().select().from(outboxEventDeliveries).where(eq(outboxEventDeliveries.listenerId, listenerId));
    expect(pending!.status).toBe("pending"); expect(handler).not.toHaveBeenCalled();
    await approvePluginPermissions.call(approval(), reviewer); await enablePlugin.call({ name: reader.name }, OWNER);
    await db().update(outboxEventDeliveries).set({ nextAttemptAt: sql`now() - interval '1 second'` }).where(eq(outboxEventDeliveries.eventId, eventId));
    await redeliverOutboxEvent(eventId);
    expect(handler).toHaveBeenCalledOnce();
  });

  it("does not enroll an inactive plugin into new events, including after later approval/replay", async () => {
    await installPlugin.call(await artifact(), OWNER);
    const handler = vi.fn(async () => {}); const listenerId = "runtimeFixture:inactive:handler";
    subscribe("runtime.inactive", listenerId, pluginListener(reader, handler), reader);
    const eventId = await db().transaction(tx => enqueue(tx, "runtime.inactive", {}));
    const [stored] = await db().select().from(outboxEvents).where(eq(outboxEvents.id, eventId));
    expect(stored!.inactivePluginListeners).toContain(listenerId);
    await redeliverOutboxEvent(eventId); expect(handler).not.toHaveBeenCalled();
    await approvePluginPermissions.call(approval(), reviewer); await enablePlugin.call({ name: reader.name }, OWNER);
    await db().update(outboxEvents).set({ status: "dead_letter", deadLetteredAt: new Date(), dispatchedAt: null }).where(eq(outboxEvents.id, eventId));
    expect(await replayOutboxEvent(eventId)).toBe(true); await redeliverOutboxEvent(eventId);
    expect(handler).not.toHaveBeenCalled();
  });

  it("keeps synthetic playground approvals invalid on a real site", async () => {
    expect(await failure(seedDemoPluginPermissions.call({}, { kind: "system" }))).toMatchObject({ code: "permission" });
    await db().delete(pluginPermissionConsents).where(eq(pluginPermissionConsents.name, "proof"));
    const previous = process.env.FREEHOLDER_PLAYGROUND;
    try {
      process.env.FREEHOLDER_PLAYGROUND = "1"; resetEnvForTests();
      await seedDemoPluginPermissions.call({}, { kind: "system" });
      expect(await getService("proof.publishedPaths").call({ locale: "en" }, { kind: "system" })).toEqual([]);
      process.env.FREEHOLDER_PLAYGROUND = "0"; resetEnvForTests();
      expect(await failure(getService("proof.publishedPaths").call({ locale: "en" }, { kind: "system" }))).toMatchObject({ code: "permission" });
    } finally {
      if (previous === undefined) delete process.env.FREEHOLDER_PLAYGROUND; else process.env.FREEHOLDER_PLAYGROUND = previous;
      resetEnvForTests();
    }
  });

  it("pauses empty scheduled polls while preserving one-off work for retry", async () => {
    await installPlugin.call(await artifact(), OWNER);
    const handler = vi.fn(async () => {});
    const cron = pluginJob(reader, { name: "runtimeFixture.poll", summary: "Poll durable fixture state.", schedule: "* * * * *", handler });
    expect(await cron.handler({})).toEqual({ skipped: "plugin-disabled" });
    await expect(cron.handler({ acceptedTask: "fixture" })).rejects.toMatchObject({ code: "permission" });
    const oneOff = pluginJob(reader, { name: "runtimeFixture.oneOff", summary: "Accepted fixture work.", handler });
    await expect(oneOff.handler({})).rejects.toMatchObject({ code: "permission" });
    expect(handler).not.toHaveBeenCalled();
    await approvePluginPermissions.call(approval(), reviewer); await enablePlugin.call({ name: reader.name }, OWNER);
    await cron.handler({}); expect(handler).toHaveBeenCalledOnce();
  });
});
