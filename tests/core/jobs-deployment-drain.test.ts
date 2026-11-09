// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.09/C10.33: canonical jobs lifecycle with injected admission and queue I/O.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type * as JobsModule from "@/core/jobs";

interface Message { id: string; retryCount: number; signal: AbortSignal; data: Record<string, unknown> }
type Callback = (messages: Message[]) => Promise<void>;
interface MockBoss { options: Record<string, unknown>; callbacks: Map<string, Callback> }

const f = vi.hoisted(() => ({
  hold: null as null | { operationId: string; sourceRevision: string; phase: "draining" | "resuming" },
  calls: [] as string[], instances: [] as MockBoss[],
  inventory: { calls: 0, pendingJobs: 0, activeJobs: 0 },
  continuation: false, stopCreatesPending: false, workers: true, inventoryUnknown: false,
  startGate: undefined as undefined | Promise<void>,
  workGate: undefined as undefined | Promise<void>,
  offGate: undefined as undefined | Promise<void>,
}));
vi.mock("@/core/db", () => ({ db: () => ({ execute: async () => [] }) }));
vi.mock("@/core/env", () => ({
  databaseUrl: () => "postgres://synthetic-fixture-only",
  env: () => ({ DATABASE_URL: "synthetic", NODE_ENV: "production", FREEHOLDER_JOBS: f.workers ? "on" : "off" }),
}));
vi.mock("@/core/jobs/health", () => ({
  EMPTY_JOB_RUNTIME_METRICS: {}, JOB_HEARTBEAT_INTERVAL_MS: 60000,
  JOB_QUEUE_LAG_DEGRADED_SECONDS: 30, publishJobRuntimePulse: async () => {},
}));
vi.mock("@/core/runtime/deployment-admission", () => ({
  readDeploymentHold: async () => f.hold,
  admitDeploymentRuntime: async () => { f.calls.push("admit"); return { hold: f.hold?.phase === "resuming" ? null : f.hold }; },
  acknowledgeDeploymentDrain: async (_id: string, op: string) => { f.calls.push("ack:" + op); return true; },
  markDeploymentRuntimeStopped: async () => { f.calls.push("normal-stopped"); },
  deploymentWorkInventory: async () => { if (f.inventoryUnknown) throw Error("deployment_inventory_unknown"); return { ...f.inventory }; },
  ensureDeploymentCronFence: async () => { f.calls.push("cron-fenced"); },
  newDeploymentWorkAllowed: async () => !f.hold || f.hold.phase === "resuming" || f.continuation,
  withDeploymentContinuation: async (work: () => Promise<unknown>) => {
    f.continuation = true;
    try { return await work(); } finally { f.continuation = false; }
  },
}));
vi.mock("pg-boss", () => ({
  fromDrizzle: () => ({}),
  PgBoss: class {
    options: Record<string, unknown>;
    callbacks = new Map<string, Callback>();
    constructor(options: Record<string, unknown>) { this.options = options; f.instances.push(this); f.calls.push("construct"); }
    on() {}
    async start() { f.calls.push("start"); await f.startGate; }
    async stop() { f.calls.push("stop"); if (f.stopCreatesPending) { f.stopCreatesPending = false; f.inventory.pendingJobs = 1; } }
    async getQueue() { return null; }
    async createQueue() {}
    async updateQueue() {}
    async getQueues() { return []; }
    async schedule(name: string) { f.calls.push("schedule:" + name); }
    async work(name: string, _options: unknown, callback: Callback) {
      f.calls.push("work:" + name); await f.workGate; this.callbacks.set(name, callback);
    }
    async offWork(name: string, options: { wait: boolean }) {
      expect(options).toEqual({ wait: true }); f.calls.push("off:" + name);
      if (name !== "__pgboss__send-it") await f.offGate;
      this.callbacks.delete(name);
    }
    async findJobs() { return [{ state: "active" }]; }
    async send(_name: string, _body: unknown, options: { id: string }) { return options.id; }
  },
}));

let jobs: typeof JobsModule;
const hold = () => ({ operationId: "11111111-1111-4111-8111-111111111111", sourceRevision: "a".repeat(40), phase: "draining" as const });
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; };
const tick = () => new Promise(r => setImmediate(r));
beforeEach(async () => {
  vi.resetModules(); Object.assign(f, { hold: null, calls: [], instances: [], inventory: { calls: 0, pendingJobs: 0, activeJobs: 0 }, continuation: false, stopCreatesPending: false, workers: true, inventoryUnknown: false, startGate: undefined, workGate: undefined, offGate: undefined });
  jobs = await import("@/core/jobs");
  jobs.registerJob(jobs.defineJob({ name: "test.first", summary: "Synthetic drain fixture", handler: async () => {} }));
});
afterEach(async () => { await jobs.stopJobs(); });

it("admits before starting, and a process born held mounts no producer or worker then resumes normally", async () => {
  f.hold = hold(); await jobs.startJobs();
  expect(f.calls).toEqual(["admit"]); expect(f.instances).toHaveLength(0);
  await jobs.reconcileJobDeploymentAdmission(); expect(f.calls).toContain("ack:" + f.hold.operationId);
  f.hold = null; await jobs.reconcileJobDeploymentAdmission();
  expect(f.instances).toHaveLength(1); expect(f.instances[0]!.options.schedule).toBe(true);
  expect(f.calls.indexOf("admit")).toBeLessThan(f.calls.indexOf("start"));
  expect(f.calls).toContain("work:test.first");
});

it("does not use stop grace or acknowledge while calls, due work or accepted handlers remain", async () => {
  await jobs.startJobs(); f.hold = hold();
  for (const name of ["calls", "pendingJobs", "activeJobs"] as const) {
    f.inventory[name] = 1; await jobs.reconcileJobDeploymentAdmission();
    expect(f.calls).not.toContain("stop"); expect(f.calls.some(x => x.startsWith("ack:"))).toBe(false);
    f.inventory[name] = 0;
  }
  await jobs.reconcileJobDeploymentAdmission();
  expect(f.calls.indexOf("off:__pgboss__send-it")).toBeLessThan(f.calls.indexOf("off:test.first"));
  expect(f.calls.indexOf("off:test.first")).toBeLessThan(f.calls.indexOf("stop"));
  expect(f.calls.at(-1)).toBe("ack:" + f.hold.operationId);
});

it("awaits an in-flight startup and dynamic worker mount before stopping every actual worker", async () => {
  const gate = deferred(); f.workGate = gate.promise;
  const started = jobs.startJobs(); await tick();
  jobs.registerJob(jobs.defineJob({ name: "test.late", summary: "Late module registration", handler: async () => {} }));
  f.hold = hold(); const drain = jobs.reconcileJobDeploymentAdmission(); await tick();
  expect(f.calls).not.toContain("stop"); gate.resolve(); await started; await drain;
  expect(f.calls).toContain("off:test.first"); expect(f.calls).toContain("off:test.late");
  expect(f.instances[0]!.callbacks.size).toBe(0); expect(f.calls.at(-1)).toMatch(/^ack:/);
});

it("waits for offWork fetch/handler completion without abort or a false early ack", async () => {
  await jobs.startJobs(); const gate = deferred(); f.offGate = gate.promise;
  f.hold = hold(); const drain = jobs.reconcileJobDeploymentAdmission(); await tick();
  expect(f.calls).toContain("off:test.first"); expect(f.calls).not.toContain("stop");
  expect(f.calls.some(x => x.startsWith("ack:"))).toBe(false);
  gate.resolve(); await drain; expect(f.calls.at(-1)).toMatch(/^ack:/);
});

it("late cron/accepted child work resumes only a schedule-disabled drain worker, then acks after its queue finishes", async () => {
  await jobs.startJobs(); f.hold = hold(); f.stopCreatesPending = true;
  await jobs.reconcileJobDeploymentAdmission();
  expect(f.instances).toHaveLength(2); expect(f.instances[1]!.options.schedule).toBe(false);
  expect(f.calls.some(x => x.startsWith("ack:"))).toBe(false);
  f.inventory.pendingJobs = 0; await jobs.reconcileJobDeploymentAdmission();
  expect(f.calls.filter(x => x.startsWith("ack:"))).toHaveLength(1);
  const after = f.calls.length; await jobs.startJobs(); expect(f.calls.length).toBe(after);
  f.hold = null; await jobs.reconcileJobDeploymentAdmission(); expect(f.instances.at(-1)!.options.schedule).toBe(true);
});

it("does not turn a producer-only role into a worker to consume late work", async () => {
  await jobs.startJobProducer(); f.hold = hold(); f.stopCreatesPending = true;
  await jobs.reconcileJobDeploymentAdmission(); expect(f.instances).toHaveLength(1);
  expect(f.calls.some(x => x.startsWith("ack:"))).toBe(false);
  expect(f.calls.some(x => x.startsWith("work:"))).toBe(false);
});

it("refuses new enqueue/retry/redrive while held, but an actually accepted handler may enqueue its continuation", async () => {
  await jobs.startJobs(); f.hold = hold();
  const tx = { execute: async () => [] } as unknown as Parameters<typeof JobsModule.enqueueJob>[0];
  await expect(jobs.enqueueJob(tx, "test.first")).rejects.toThrow(/paused/);
  await expect(jobs.retryJob(tx, "test.first", "synthetic")).rejects.toThrow(/paused/);
  await expect(jobs.redriveDeadLetters(tx)).rejects.toThrow(/paused/);
  let enqueued = false;
  jobs.registerJob(jobs.defineJob({ name: "test.parent", summary: "Accepted child continuation", handler: async () => { await jobs.enqueueJob(tx, "test.first"); enqueued = true; } }));
  f.hold = null; await jobs.startJobs(); f.hold = hold();
  await f.instances[0]!.callbacks.get("test.parent")!([{ id: "synthetic-parent", retryCount: 0, signal: new AbortController().signal, data: {} }]);
  expect(enqueued).toBe(true); expect(f.continuation).toBe(false);
});

it("an explicit resuming phase restarts the ordinary role and scheduler before final hold release", async () => {
  await jobs.startJobs(); f.hold = hold(); await jobs.reconcileJobDeploymentAdmission();
  expect(f.calls.filter(x => x.startsWith("ack:"))).toHaveLength(1);
  f.hold = { ...hold(), phase: "resuming" }; await jobs.reconcileJobDeploymentAdmission();
  expect(f.instances).toHaveLength(2); expect(f.instances[1]!.options.schedule).toBe(true);
  expect(f.instances[1]!.callbacks.has("test.first")).toBe(true);
  expect(f.calls.filter(x => x.startsWith("ack:"))).toHaveLength(1);
});

it("a changed hold cannot be acknowledged as drained", async () => {
  await jobs.startJobs(); f.hold = hold(); const gate = deferred(); f.offGate = gate.promise;
  const drain = jobs.reconcileJobDeploymentAdmission(); await tick();
  f.hold = { ...hold(), operationId: "22222222-2222-4222-8222-222222222222" };
  gate.resolve(); await drain;
  expect(f.calls.some(x => x.startsWith("ack:"))).toBe(false);
});

it("an unavailable inventory stays unknown, without stopping accepted work or acknowledging", async () => {
  await jobs.startJobs(); f.hold = hold(); f.inventoryUnknown = true;
  await expect(jobs.reconcileJobDeploymentAdmission()).rejects.toThrow("deployment_inventory_unknown");
  expect(f.calls).not.toContain("stop"); expect(f.calls.some(x => x.startsWith("ack:"))).toBe(false);
});

it("a scheduled definition registered during a busy hold is restored on resume, without changing the role", async () => {
  await jobs.startJobs(); f.hold = hold(); f.inventory.activeJobs = 1;
  jobs.registerJob(jobs.defineJob({ name: "test.lateSchedule", summary: "Late scheduled module", schedule: "0 * * * *", handler: async () => {} }));
  await jobs.reconcileJobDeploymentAdmission();
  expect(f.calls).not.toContain("schedule:test.lateSchedule"); expect(f.calls).not.toContain("stop");
  f.hold = null; f.inventory.activeJobs = 0; await jobs.reconcileJobDeploymentAdmission();
  expect(f.instances).toHaveLength(1);
  expect(f.calls.filter(x => x === "schedule:test.lateSchedule")).toHaveLength(1);
});
