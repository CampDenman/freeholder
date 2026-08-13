// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The durable queue contract (MASTER.md §43 C1.09).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { count, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/core/db";
import { resetEnvForTests } from "@/core/env";
import {
  DEAD_LETTER_QUEUE,
  cancelJob,
  defineJob,
  enqueueJob,
  getJob,
  isJobStuck,
  JobContractError,
  pruneJobIdempotencyKeys,
  registerJob,
  resolvedJobPolicy,
  startJobProducer,
  startJobs,
  stopJobs,
  type EnqueuedJob,
} from "@/core/jobs";
import {
  backgroundJobsBriefingContribution,
  cancelJobRun,
  getJobSummary,
  listJobQueues,
  listJobRuns,
  redriveJobDeadLetters,
  retryJobRun,
} from "@/core/jobs/service";
import { jobIdempotencyKeys } from "@/core/jobs/schema";
import { auditLog } from "@/core/events/schema";
import { ready } from "@/core/runtime";
import { defineService, ServiceError, type Tx } from "@/core/service";
import {
  closeDb,
  failure,
  hasDatabase,
  STAFF,
  truncateSpine,
} from "../helpers/spine";

const pause = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

async function eventually(
  predicate: () => Promise<boolean>,
  timeoutMilliseconds = 12_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMilliseconds;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await pause(50);
  }
  throw new Error("Timed out waiting for the background job state.");
}

describe("job definitions", () => {
  it("resolve safe retry, concurrency and lease defaults", () => {
    const policy = resolvedJobPolicy(
      defineJob({
        name: "test.policyDefaults",
        summary: "Exercise queue policy defaults.",
        handler: async () => null,
      }),
    );
    expect(policy).toMatchObject({
      retry: { limit: 5, delaySeconds: 30, backoff: true, maxDelaySeconds: 3_600 },
      concurrency: 1,
      leaseSeconds: 900,
      heartbeatSeconds: 60,
    });
  });

  it("rejects definitions that could silently bypass operational limits", () => {
    expect(() =>
      defineJob({
        name: "not-dotted",
        summary: "No stable namespace.",
        handler: async () => null,
      }),
    ).toThrow(JobContractError);
    expect(() =>
      defineJob({
        name: "test.unbounded",
        summary: "Invalid concurrency.",
        concurrency: 0,
        handler: async () => null,
      }),
    ).toThrow(/concurrency/);
    expect(() =>
      defineJob({
        name: "test.noLease",
        summary: "Invalid lease.",
        leaseSeconds: 5,
        handler: async () => null,
      }),
    ).toThrow(/leaseSeconds/);
    expect(() =>
      defineJob({
        name: DEAD_LETTER_QUEUE,
        summary: "Attempt to claim the platform recovery queue.",
        handler: async () => null,
      }),
    ).toThrow(/reserved/);
  });
});

describe.runIf(hasDatabase)("transactional background work", () => {
  const originalJobsSetting = process.env.FREEHOLDER_JOBS;
  const attempts = new Map<string, number>();
  const observedRetryAttempts: number[] = [];
  let active = 0;
  let maximumActive = 0;
  let cancelHandlerStarted = false;
  let cancelHandlerFinished = false;
  let leaseHeartbeatLive = false;

  const transactional = defineJob({
    name: "test.transactional",
    summary: "A transaction-bound test job.",
    handler: async () => null,
  });

  const retries = defineJob({
    name: "test.retries",
    summary: "Fail once and prove retry policy executes.",
    retry: { limit: 2, delaySeconds: 1, backoff: true, maxDelaySeconds: 2 },
    concurrency: 2,
    leaseSeconds: 30,
    handler: async (data, context) => {
      const key = String(data.key);
      const attempt = (attempts.get(key) ?? 0) + 1;
      attempts.set(key, attempt);
      observedRetryAttempts.push(context?.attempt ?? -1);
      if (attempt === 1) throw new Error("first attempt fails on purpose");
      return { attempt };
    },
  });

  const serial = defineJob({
    name: "test.serial",
    summary: "Prove global queue concurrency is one.",
    concurrency: 1,
    leaseSeconds: 30,
    handler: async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await pause(120);
      active -= 1;
    },
  });

  const cancellable = defineJob({
    name: "test.cancellable",
    summary: "Stop cooperatively after durable cancellation.",
    leaseSeconds: 30,
    handler: async (_data, context) => {
      if (!context) throw new Error("worker context is required");
      cancelHandlerStarted = true;
      for (let index = 0; index < 100; index += 1) {
        await pause(20);
        await context.throwIfCancelled();
      }
      cancelHandlerFinished = true;
    },
  });

  const leased = defineJob({
    name: "test.leased",
    summary: "Hold and refresh a short worker lease.",
    leaseSeconds: 30,
    handler: async (_data, context) => {
      if (!context) throw new Error("worker context is required");
      await pause(200);
      leaseHeartbeatLive = await context.heartbeat();
    },
  });

  const deadLettered = defineJob({
    name: "test.deadLettered",
    summary: "Exhaust immediately so the recovery queue can be exercised.",
    retry: { limit: 0, delaySeconds: 0, backoff: false, maxDelaySeconds: 1 },
    leaseSeconds: 30,
    handler: async () => {
      throw new Error("deliberate dead-letter failure");
    },
  });

  const queueFromService = defineService({
    name: "test.queueFromService",
    summary: "Queue work from a service transaction.",
    kind: "mutation",
    permission: "scoped",
    input: z.object({
      key: z.string(),
      value: z.string(),
      fail: z.boolean().default(false),
    }),
    handler: async (input, ctx): Promise<EnqueuedJob> => {
      const queued = await ctx.queueJob(
        transactional.name,
        { value: input.value },
        { idempotencyKey: input.key },
      );
      if (input.fail) throw new ServiceError("validation", "roll the caller back");
      return queued;
    },
  });

  beforeAll(async () => {
    process.env.FREEHOLDER_JOBS = "on";
    resetEnvForTests();
    await ready();
    for (const job of [transactional, retries, serial, cancellable, leased, deadLettered]) {
      registerJob(job);
    }
    await startJobProducer();
  });

  beforeEach(async () => {
    await truncateSpine();
    const producer = await startJobProducer();
    for (const job of [transactional, retries, serial, cancellable, leased, deadLettered]) {
      await producer?.deleteAllJobs(job.name);
    }
    await producer?.deleteAllJobs(DEAD_LETTER_QUEUE);
    attempts.clear();
    observedRetryAttempts.length = 0;
    active = 0;
    maximumActive = 0;
    cancelHandlerStarted = false;
    cancelHandlerFinished = false;
    leaseHeartbeatLive = false;
  });

  afterAll(async () => {
    await stopJobs();
    if (originalJobsSetting === undefined) delete process.env.FREEHOLDER_JOBS;
    else process.env.FREEHOLDER_JOBS = originalJobsSetting;
    resetEnvForTests();
    await closeDb();
  });

  it("commits the business call, idempotency claim and pg-boss row together", async () => {
    const rolledBack = await failure(
      queueFromService.call({ key: "rolled-back", value: "no", fail: true }, STAFF),
    );
    expect(rolledBack.code).toBe("validation");
    expect((await db().select({ total: count() }).from(jobIdempotencyKeys))[0]?.total).toBe(0);
    expect(await (await startJobProducer())?.findJobs(transactional.name)).toHaveLength(0);

    const committed = await queueFromService.call(
      { key: "committed", value: "yes", fail: false },
      STAFF,
    );
    expect(committed.deduplicated).toBe(false);
    expect((await getJob(transactional.name, committed.id))?.data).toEqual({ value: "yes" });
    expect((await db().select({ total: count() }).from(jobIdempotencyKeys))[0]?.total).toBe(1);
  });

  it("deduplicates matching keys and refuses key reuse with different data", async () => {
    const first = await queueFromService.call(
      { key: "same-operation", value: "same", fail: false },
      STAFF,
    );
    const duplicate = await queueFromService.call(
      { key: "same-operation", value: "same", fail: false },
      STAFF,
    );
    expect(duplicate).toEqual({ ...first, deduplicated: true });
    expect(await (await startJobProducer())?.findJobs(transactional.name)).toHaveLength(1);

    const mismatch = await failure(
      queueFromService.call(
        { key: "same-operation", value: "different", fail: false },
        STAFF,
      ),
    );
    expect(mismatch).toBeInstanceOf(JobContractError);
    expect(mismatch.message).toMatch(/different job data/);
  });

  it("serializes concurrent callers onto one idempotent job", async () => {
    const [left, right] = await Promise.all([
      queueFromService.call(
        { key: "concurrent-operation", value: "same", fail: false },
        STAFF,
      ),
      queueFromService.call(
        { key: "concurrent-operation", value: "same", fail: false },
        STAFF,
      ),
    ]);
    expect(left.id).toBe(right.id);
    expect([left.deduplicated, right.deduplicated].sort()).toEqual([false, true]);
    expect(await (await startJobProducer())?.findJobs(transactional.name)).toHaveLength(1);
  });

  it("prunes expired claims so a deliberate later operation can reuse the key", async () => {
    const first = await queueFromService.call(
      { key: "bounded-operation", value: "same", fail: false },
      STAFF,
    );
    await db()
      .update(jobIdempotencyKeys)
      .set({
        createdAt: sql`now() - interval '2 days'`,
        expiresAt: sql`now() - interval '1 day'`,
      })
      .where(eq(jobIdempotencyKeys.jobId, first.id));
    expect(await pruneJobIdempotencyKeys()).toBe(1);

    const later = await queueFromService.call(
      { key: "bounded-operation", value: "same", fail: false },
      STAFF,
    );
    expect(later.id).not.toBe(first.id);
    expect(later.deduplicated).toBe(false);
  });

  it("installs retry, backoff, global concurrency and heartbeat lease policy", async () => {
    const producer = await startJobProducer();
    const retryQueue = await producer?.getQueue(retries.name);
    expect(retryQueue).toMatchObject({
      retryLimit: 2,
      retryDelay: 1,
      retryBackoff: true,
      retryDelayMax: 2,
      expireInSeconds: 30,
      heartbeatSeconds: 10,
      deadLetter: DEAD_LETTER_QUEUE,
    });
    expect(resolvedJobPolicy(serial).concurrency).toBe(1);
    expect(resolvedJobPolicy(leased)).toMatchObject({
      leaseSeconds: 30,
      heartbeatSeconds: 10,
    });
  });

  it("permission-checks, cancels and deliberately retries retained work through services", async () => {
    const queued = await db().transaction((tx) =>
      ctxlessEnqueue(tx, transactional.name, { value: "cancel me" }),
    );
    const agentError = await failure(
      listJobRuns.call(
        { name: transactional.name },
        { kind: "agent", keyName: "operator", scopes: ["platform.*"] },
      ),
    );
    expect(agentError.code).toBe("permission");
    await expect(listJobQueues.call({}, STAFF)).resolves.toEqual(
      expect.arrayContaining([transactional.name, DEAD_LETTER_QUEUE]),
    );

    const stepUpError = await failure(
      cancelJobRun.call(
        { name: transactional.name, id: queued.id, confirm: "CANCEL" },
        {
          ...STAFF,
          security: {
            twoFactorRequired: true,
            twoFactorEnrolled: true,
            twoFactorVerified: true,
            stepUpValid: false,
          },
        },
      ),
    );
    expect(stepUpError.code).toBe("step_up_required");

    await expect(
      cancelJobRun.call(
        { name: transactional.name, id: queued.id, confirm: "CANCEL" },
        STAFF,
      ),
    ).resolves.toEqual({ cancelled: true });
    expect((await getJob(transactional.name, queued.id))?.state).toBe("cancelled");
    await expect(
      retryJobRun.call(
        { name: transactional.name, id: queued.id, confirm: "RETRY" },
        STAFF,
      ),
    ).resolves.toEqual({ retried: true });
    expect((await getJob(transactional.name, queued.id))?.state).not.toBe("cancelled");

    const retained = await getJob(transactional.name, queued.id);
    expect(
      isJobStuck(
        {
          ...retained!,
          state: "active",
          startedOn: new Date("2026-01-01T00:00:00.000Z"),
          heartbeatOn: new Date("2026-01-01T00:00:10.000Z"),
          heartbeatSeconds: 10,
        },
        new Date("2026-01-01T00:00:20.000Z"),
      ),
    ).toBe(true);
    expect(
      isJobStuck(
        { ...retained!, state: "completed" },
        new Date("2027-01-01T00:00:00.000Z"),
      ),
    ).toBe(false);

    const audit = await db().select({ action: auditLog.action }).from(auditLog);
    expect(audit.map((row) => row.action)).toEqual(
      expect.arrayContaining(["platform.cancelJob", "platform.retryJob"]),
    );
  });

  it(
    "executes retry/backoff and serializes a globally limited queue",
    async () => {
      await startJobs();
      const retryReceipt = await db().transaction((tx) =>
        ctxlessEnqueue(tx, retries.name, { key: "retry-once" }),
      );
      await eventually(
        async () => (await getJob(retries.name, retryReceipt.id))?.state === "completed",
      );
      expect(attempts.get("retry-once")).toBe(2);
      expect(observedRetryAttempts).toEqual([1, 2]);

      const serialReceipts: EnqueuedJob[] = [];
      for (let index = 0; index < 3; index += 1) {
        serialReceipts.push(
          await db().transaction((tx) => ctxlessEnqueue(tx, serial.name, { index })),
        );
      }
      await eventually(async () => {
        const states = await Promise.all(
          serialReceipts.map(async (receipt) => (await getJob(serial.name, receipt.id))?.state),
        );
        return states.every((state) => state === "completed");
      });
      expect(maximumActive).toBe(1);
    },
    20_000,
  );

  it("makes active cancellation visible and keeps a live lease refreshed", async () => {
    await startJobs();
    const cancellableReceipt = await db().transaction((tx) =>
      ctxlessEnqueue(tx, cancellable.name),
    );
    await eventually(async () => cancelHandlerStarted);
    expect(
      await db().transaction((tx) => cancelJob(tx, cancellable.name, cancellableReceipt.id)),
    ).toBe(true);
    await eventually(
      async () => (await getJob(cancellable.name, cancellableReceipt.id))?.state === "cancelled",
    );
    await pause(100);
    expect(cancelHandlerFinished).toBe(false);

    const leaseReceipt = await db().transaction((tx) => ctxlessEnqueue(tx, leased.name));
    await eventually(async () => (await getJob(leased.name, leaseReceipt.id))?.state === "completed");
    expect(leaseHeartbeatLive).toBe(true);
  });

  it(
    "retains exhausted failures, redacts inspection, reports them and redrives deliberately",
    async () => {
      await startJobs();
      const receipt = await db().transaction((tx) =>
        ctxlessEnqueue(tx, deadLettered.name, {
          customer: "Ada",
          apiToken: "must-never-render",
          nested: { password: "also-secret", note: "visible" },
        }),
      );

      await eventually(async () => {
        const rows = await (await startJobProducer())?.findJobs(DEAD_LETTER_QUEUE);
        return rows?.some((job) => job.sourceId === receipt.id) ?? false;
      });

      const runs = await listJobRuns.call(
        { name: DEAD_LETTER_QUEUE, limit: 50, offset: 0 },
        STAFF,
      );
      const dead = runs.items.find((job) => job.sourceId === receipt.id);
      expect(dead).toMatchObject({
        name: DEAD_LETTER_QUEUE,
        sourceName: deadLettered.name,
        sourceId: receipt.id,
        data: {
          customer: "Ada",
          apiToken: "[redacted]",
          nested: { password: "[redacted]", note: "visible" },
        },
      });

      const summary = await getJobSummary.call({}, STAFF);
      expect(summary.deadLetters).toBeGreaterThanOrEqual(1);
      expect(summary.failed).toBe(0);
      const contribution = await backgroundJobsBriefingContribution(summary);
      expect(contribution).toMatchObject({
        key: "platform.jobs",
        severity: "danger",
        href: "/admin/jobs",
      });

      await expect(
        redriveJobDeadLetters.call(
          { sourceName: deadLettered.name, limit: 1, confirm: "REDRIVE" },
          STAFF,
        ),
      ).resolves.toEqual({ moved: 1 });
      const audit = await db().select({ action: auditLog.action }).from(auditLog);
      expect(audit.map((row) => row.action)).toContain("platform.redriveDeadLetters");
    },
    20_000,
  );
});

async function ctxlessEnqueue(
  tx: Tx,
  name: string,
  data: Record<string, unknown> = {},
): Promise<EnqueuedJob> {
  return enqueueJob(tx, name, data);
}
