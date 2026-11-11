// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { publish, subscribe } from "@/core/events";
import { actorString, defineOrchestratedService, defineService, permits, type Tx } from "@/core/service";
import { bindPluginService, currentPluginAudit, currentPluginExecution, pluginActor, pluginServiceOwner, registerPluginExecution, withPluginExecution, withServiceTransaction } from "@/core/plugins/context";

const descriptor = registerPluginExecution({ name: "runtime-fixture", version: "0.1.0", permissions: ["contacts:read"] });

describe("plugin service execution identity (C3.40)", () => {
  it("starts trusted core event callbacks outside the initiating plugin's identity", async () => {
    const observed: Array<{ execution: string | undefined; origin: string | undefined }> = [];
    subscribe("fixture.pluginInitiated", "fixture:core", async () => { observed.push({ execution: currentPluginExecution()?.name, origin: currentPluginAudit()?.name }); });
    await withPluginExecution(descriptor, () => publish("fixture.pluginInitiated", {}));
    expect(observed).toEqual([{ execution: undefined, origin: undefined }]);
  });
  it("refuses nested direct calls that would open a second transaction or perform provider orchestration", async () => {
    const definition = { name: "contacts.transactionProbe", summary: "Fixture nested transaction probe.", kind: "query" as const, permission: "public" as const, input: z.object({}), output: z.boolean() };
    const ordinary = defineService({ ...definition, handler: async () => true });
    const orchestrated = defineOrchestratedService({ ...definition, handler: async () => true });
    await withServiceTransaction({} as Tx, new Set(), async () => {
      for (const service of [ordinary, orchestrated]) {
        await expect(service.call({}, { kind: "system" })).rejects.toMatchObject({ code: "internal" });
      }
    });
  });
  it("maps declared grants to a named actor without personal or system authority", () => {
    const actor = pluginActor(descriptor);
    expect(actorString(actor)).toBe("plugin:runtime-fixture");
    expect(permits(actor, "scoped", "contacts.list", "query")).toBe(true);
    expect(permits(actor, "scoped", "contacts.create", "mutation")).toBe(false);
    expect(permits(actor, "public", "invoicing.list", "query")).toBe(false);
    expect(permits(actor, "authenticated", "contacts.mine", "query")).toBe(false);
    expect(permits(actor, "system", "contacts.resolve", "mutation")).toBe(false);
  });

  it("does not let a plugin claim another service namespace", () => {
    const definition = { name: "runtimeFixture.probe" };
    bindPluginService(definition, descriptor);
    expect(pluginServiceOwner(definition)).toBe(descriptor);
    expect(() => bindPluginService({ name: "apikeys.create" }, descriptor)).toThrow(/namespace/);
  });

  it("replaces forged system and owner actors before authorizing cross-module calls", async () => {
    const forbidden = defineOrchestratedService({ name: "invoicing.pluginProbe", summary: "Fixture forbidden operation.", kind: "mutation", permission: "scoped", input: z.object({}), output: z.boolean(), handler: async () => true });
    for (const actor of [{ kind: "system" } as const, { kind: "user", userId: "fixture", role: "owner", grants: [{ module: "*", access: "manage" }] } as const]) {
      await expect(withPluginExecution(descriptor, () => forbidden.call({}, actor))).rejects.toMatchObject({ code: "permission" });
    }
  });

  it("keeps a permitted core operation's own composition authority and plugin attribution", async () => {
    const internal = defineOrchestratedService({ name: "platform.pluginProbeInternal", summary: "Trusted core fixture phase.", kind: "query", permission: "system", input: z.object({}), output: z.string(), handler: async () => currentPluginAudit()?.name ?? "missing" });
    const allowed = defineOrchestratedService({ name: "contacts.pluginProbeRead", summary: "Fixture permitted operation.", kind: "query", permission: "scoped", input: z.object({}), output: z.object({ actor: z.string(), activePlugin: z.boolean(), origin: z.string() }), handler: async (_input, actor) => ({ actor: actorString(actor), activePlugin: Boolean(currentPluginExecution()), origin: await internal.call({}, { kind: "system" }) }) });
    expect(await withPluginExecution(descriptor, () => allowed.call({}, { kind: "system" }))).toEqual({ actor: "plugin:runtime-fixture", activePlugin: false, origin: "runtime-fixture" });
    expect(currentPluginExecution()).toBeUndefined(); expect(currentPluginAudit()).toBeUndefined();
  });

  it("refuses human-review operations even when the plugin's caller supplied an owner", async () => {
    const human = defineOrchestratedService({ name: "contacts.pluginProbeReview", summary: "Human fixture review.", kind: "query", permission: "scoped", agentCallable: false, input: z.object({}), output: z.boolean(), handler: async () => true });
    await expect(withPluginExecution(descriptor, () => human.call({}, { kind: "system" }))).rejects.toMatchObject({ code: "permission" });
  });

  it("keeps concurrent plugin scopes separate across awaited work", async () => {
    const other = registerPluginExecution({ name: "other-fixture", version: "0.1.0", permissions: ["invoicing:write"] });
    const result = await Promise.all([descriptor, other].map(plugin => withPluginExecution(plugin, async () => {
      await Promise.resolve(); return currentPluginExecution()?.name;
    })));
    expect(result).toEqual([descriptor.name, other.name]); expect(currentPluginExecution()).toBeUndefined();
  });
});
