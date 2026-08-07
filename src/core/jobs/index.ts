// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
// Background work (MASTER.md §3, §9, §11).
//
// pg-boss, because the database is already there. §2's "one sacred database"
// argument applies to queues as well: an owner who deploys Freeholder should
// not also be operating Redis, and a job that cannot be enqueued in the same
// transaction as the change that caused it is a job that runs for a change
// that rolled back.
//
// ── Where the worker runs ─────────────────────────────────────────────────
//
// In the web process, by default. §18's recipe manifest already distinguishes
// `jobs: web-process` from `worker-process`, and for a single box the first is
// right: one container, one thing to restart, no second deployment to forget.
// pg-boss takes its own locks, so an owner who scales to several replicas gets
// one scheduled run rather than one per replica — the scaling story works
// without a second process, and a target that needs one sets FREEHOLDER_JOBS.
import { PgBoss } from "pg-boss";
import { env, databaseUrl } from "@/core/env";

/** What a job is. */
export interface JobDefinition {
  /** Dotted, like a service: "core.sweepSessions". */
  name: string;
  summary: string;
  /**
   * Cron, in UTC, when this should run on a schedule.
   *
   * Absent means the job only runs when something sends it — which is the
   * right shape for work caused by an event rather than by the clock.
   */
  schedule?: string;
  /** Runs outside any request. Must tolerate running twice (see the outbox). */
  handler: (data: Record<string, unknown>) => Promise<unknown>;
}

export function defineJob(job: JobDefinition): JobDefinition {
  return job;
}

const registry = new Map<string, JobDefinition>();

export function registerJob(job: JobDefinition): void {
  const existing = registry.get(job.name);
  if (existing === job) return;
  if (existing) {
    throw new Error(`job "${job.name}" registered twice by two definitions`);
  }
  registry.set(job.name, job);
}

export function listJobs(): ReadonlyMap<string, JobDefinition> {
  return registry;
}

let boss: PgBoss | undefined;
let starting: Promise<PgBoss | undefined> | undefined;

/**
 * Whether this process should run jobs at all.
 *
 * Off during `next build` (no database, and nothing to do), off in tests
 * unless asked (a suite should not race a scheduler), and off when an owner
 * has moved the worker elsewhere.
 */
function jobsEnabled(): boolean {
  if (env().FREEHOLDER_JOBS === "off") return false;
  if (process.env.NEXT_PHASE === "phase-production-build") return false;
  if (env().NODE_ENV === "test" && env().FREEHOLDER_JOBS !== "on") return false;
  return Boolean(env().DATABASE_URL);
}

/**
 * Start the worker and mount every registered job.
 *
 * Idempotent and memoized: boot is a precondition rather than a one-shot event
 * (core/runtime.ts), so this may be asked for more than once per process.
 */
export async function startJobs(): Promise<PgBoss | undefined> {
  if (!jobsEnabled()) return undefined;
  if (boss) return boss;
  starting ??= (async () => {
    const instance = new PgBoss({
      connectionString: databaseUrl(),
      // Its own schema, so `pgboss` tables never collide with the platform's
      // and a migration diff never shows somebody else's bookkeeping.
      schema: "pgboss",
      // A small pool: this is a monolith sharing a box with the web server,
      // and a queue that starves the request path is worse than a slow queue.
      max: 2,
    });

    instance.on("error", (error) => {
      // The queue failing must never take the site down with it.
      console.error("[jobs] pg-boss error", error);
    });

    await instance.start();

    for (const job of registry.values()) {
      await instance.createQueue(job.name);
      await instance.work(job.name, async (messages) => {
        for (const message of messages) {
          await job.handler((message.data ?? {}) as Record<string, unknown>);
        }
      });
      if (job.schedule) {
        // `schedule` is an upsert keyed by queue name, so a changed cron takes
        // effect on the next deploy rather than needing anything unscheduled.
        await instance.schedule(job.name, job.schedule);
      }
    }

    boss = instance;
    console.log(
      `[jobs] worker running: ${registry.size} job(s), ${
        [...registry.values()].filter((j) => j.schedule).length
      } scheduled`,
    );
    return instance;
  })();
  return starting;
}

/** Enqueue work. Inside a transaction, prefer `sendInTransaction`. */
export async function send(
  name: string,
  data: Record<string, unknown> = {},
): Promise<string | null> {
  const instance = await startJobs();
  if (!instance) return null;
  return instance.send(name, data);
}

export async function stopJobs(): Promise<void> {
  const instance = boss;
  boss = undefined;
  starting = undefined;
  await instance?.stop({ graceful: true });
}
