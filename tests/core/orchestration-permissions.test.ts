// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Exact public verbs authorize only explicitly bound private phases (C3.22/C11.10).
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { auditLog } from "@/core/events/schema";
import { actorString, defineOrchestratedService, defineService, type Actor } from "@/core/service";
import { bindPluginService, registerPluginExecution } from "@/core/plugins/context";
import { closeDb, failure, hasDatabase, truncateSpine } from "../helpers/spine";

const agent: Actor = { kind: "agent", keyName: "exact-workflow", scopes: ["probe.workflow"] };
const phase = defineService({ name: "probe.phase", orchestratedBy: "probe.workflow", summary: "Private phase.", kind: "mutation", permission: "scoped", external: false, input: z.object({}), output: z.object({ actor: z.string() }), handler: async (_, ctx) => ({ actor: actorString(ctx.actor) }) });
const otherPhase = defineService({ name: "probe.otherPhase", orchestratedBy: "probe.other", summary: "Different parent.", kind: "mutation", permission: "scoped", external: false, input: z.object({}), handler: async () => ({}) });
const unbound = defineService({ name: "probe.unbound", summary: "Not bound to an orchestrator.", kind: "mutation", permission: "scoped", external: false, input: z.object({}), handler: async () => ({}) });

describe("private phase definition boundaries", () => {
  it("refuses public, system and cross-family phase declarations and plugin bindings", () => {
    const definition = { name: "probe.bad", orchestratedBy: "probe.workflow", summary: "Invalid", kind: "mutation" as const, permission: "scoped" as const, external: false, input: z.object({}), handler: async () => ({}) };
    expect(() => defineService({ ...definition, external: true })).toThrow(/private/);
    expect(() => defineService({ ...definition, permission: "system" })).toThrow(/scoped/);
    expect(() => defineService({ ...definition, orchestratedBy: "other.workflow" })).toThrow(/family/);
    const plugin = registerPluginExecution({ name: "phase-probe", version: "1.0.0", permissions: [] });
    expect(() => bindPluginService({ ...phase.def, name: "phaseProbe.phase" }, plugin)).toThrow(/reserved for core/);
  });
});

describe.runIf(hasDatabase)("exact public orchestration permissions", () => {
  beforeEach(truncateSpine);
  afterAll(closeDb);

  it("keeps an exact key and its audit identity across private phases without adding grants", async () => {
    const workflow = defineOrchestratedService({ name: "probe.workflow", summary: "Public operation", kind: "mutation", permission: "scoped", input: z.object({}), handler: async (_, actor) => phase.call({}, actor) });
    expect(await workflow.call({}, agent)).toEqual({ actor: "agent:exact-workflow" });
    expect(agent.scopes).toEqual(["probe.workflow"]);
    const [entry] = await db().select().from(auditLog).where(eq(auditLog.action, "probe.phase"));
    expect(entry).toMatchObject({ actor: "agent:exact-workflow" });
    expect((await failure(phase.call({}, agent))).code).toBe("permission");
  });

  it("does not authorize another actor, another phase, or an ordinary same-transaction composition", async () => {
    const ordinary = defineService({ name: "probe.ordinary", summary: "A normal service", kind: "mutation", permission: "public", input: z.object({}), handler: async (_, ctx) => ctx.call(phase, {}) });
    const workflow = defineOrchestratedService({ name: "probe.workflow", summary: "Public operation", kind: "mutation", permission: "scoped", input: z.object({}), handler: async (_, actor) => {
      const clone: Actor = { ...agent, scopes: ["probe.workflow"] };
      expect((await failure(phase.call({}, clone))).code).toBe("permission");
      expect((await failure(otherPhase.call({}, actor))).code).toBe("permission");
      expect((await failure(unbound.call({}, actor))).code).toBe("permission");
      expect((await failure(ordinary.call({}, actor))).code).toBe("permission");
      return phase.call({}, actor);
    } });
    expect(await workflow.call({}, agent)).toEqual({ actor: "agent:exact-workflow" });
  });

  it("does not leak a parent authorization through a nested or concurrent orchestrator", async () => {
    const other = defineOrchestratedService({ name: "probe.other", summary: "Other operation", kind: "mutation", permission: "scoped", input: z.object({}), handler: async (_, actor) => ({ refused: (await failure(phase.call({}, actor))).code }) });
    const both: Actor = { kind: "agent", keyName: "both", scopes: ["probe.workflow", "probe.other"] };
    const workflow = defineOrchestratedService({ name: "probe.workflow", summary: "Public operation", kind: "mutation", permission: "scoped", input: z.object({}), handler: async (_, actor) => {
      expect(await other.call({}, actor)).toEqual({ refused: "permission" });
      return phase.call({}, actor);
    } });
    const results = await Promise.all([workflow.call({}, both), other.call({}, both)]);
    expect(results).toEqual([{ actor: "agent:both" }, { refused: "permission" }]);
  });

  it("expires authorization in dangling async work after the parent returns or throws", async () => {
    let release!: () => void;
    let pending!: Promise<unknown>;
    const workflow = defineOrchestratedService({ name: "probe.workflow", summary: "Public operation", kind: "mutation", permission: "scoped", input: z.object({ fail: z.boolean() }), handler: async ({ fail }, actor) => {
      const wait = new Promise<void>(resolve => { release = resolve; });
      pending = wait.then(() => failure(phase.call({}, actor)));
      if (fail) throw new Error("Expected fault");
      return {};
    } });
    for (const fail of [false, true]) {
      if (fail) await expect(workflow.call({ fail }, agent)).rejects.toThrow("Expected fault");
      else await workflow.call({ fail }, agent);
      release();
      expect(await pending).toMatchObject({ code: "permission" });
    }
  });


  it("cannot authorize a mutation phase through a query operation", async () => {
    const readActor: Actor = { kind: "agent", keyName: "read-operation", scopes: ["probe.queryWorkflow"] };
    const write = defineService({ ...phase.def, name: "probe.queryWrite", orchestratedBy: "probe.queryWorkflow" });
    const read = defineService({ ...phase.def, name: "probe.queryRead", kind: "query", orchestratedBy: "probe.queryWorkflow" });
    const workflow = defineOrchestratedService({ name: "probe.queryWorkflow", summary: "Read-only public operation", kind: "query", permission: "scoped", input: z.object({}), handler: async (_, actor) => {
      expect((await failure(write.call({}, actor))).code).toBe("permission");
      return read.call({}, actor);
    } });
    expect(await workflow.call({}, readActor)).toEqual({ actor: "agent:read-operation" });
    expect(await db().select().from(auditLog).where(eq(auditLog.action, "probe.queryWrite"))).toHaveLength(0);
  });
  it("keeps human-only restrictions inside a bound phase", async () => {
    const human = defineService({ ...phase.def, name: "probe.humanPhase", agentCallable: false });
    const workflow = defineOrchestratedService({ name: "probe.workflow", summary: "Public operation", kind: "mutation", permission: "scoped", input: z.object({}), handler: async (_, actor) => human.call({}, actor) });
    expect((await failure(workflow.call({}, agent))).code).toBe("permission");
  });
});
