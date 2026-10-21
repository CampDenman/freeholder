// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Durable queue-runtime health shared by readiness, Doctor and the worker.
import { desc, lt, sql } from "drizzle-orm";
import { db } from "@/core/db";
import { env } from "@/core/env";
import { jobRuntimeHeartbeats } from "@/core/jobs/schema";
import { PLATFORM_VERSION } from "@/core/platform";

export const JOB_HEARTBEAT_INTERVAL_MS = 15_000;
export const JOB_HEARTBEAT_STALE_SECONDS = 45;
export const JOB_QUEUE_LAG_DEGRADED_SECONDS = 5 * 60;
const HEARTBEAT_RETENTION_DAYS = 7;

export type JobRuntimeRole = "producer" | "worker";
export type JobRuntimeState =
  | "starting"
  | "ready"
  | "degraded"
  | "stopping"
  | "stopped";

export interface JobRuntimeMetrics {
  registeredJobs: number;
  mountedWorkers: number;
  scheduledJobs: number;
  queuedJobs: number;
  readyJobs: number;
  activeJobs: number;
  failedJobs: number;
  deadLetters: number;
  queueLagSeconds: number;
}

export interface JobRuntimePulse extends JobRuntimeMetrics {
  instanceId: string;
  role: JobRuntimeRole;
  state: JobRuntimeState;
  lastErrorCode?: string;
  lastErrorAt?: Date;
}

export interface JobRuntimeEvidence extends JobRuntimeMetrics {
  ready: boolean;
  state: "disabled" | "starting" | "ready" | "degraded" | "unavailable";
  reason:
    | "database_unconfigured"
    | "no_live_producer"
    | "no_live_worker"
    | "worker_version_mismatch"
    | "worker_starting"
    | "worker_degraded"
    | "ready";
  producers: number;
  workers: number;
  currentVersionWorkers: number;
  staleInstances: number;
  heartbeatAgeSeconds: number | null;
  lastErrorCode: string | null;
}

export const EMPTY_JOB_RUNTIME_METRICS: Readonly<JobRuntimeMetrics> = Object.freeze({
  registeredJobs: 0,
  mountedWorkers: 0,
  scheduledJobs: 0,
  queuedJobs: 0,
  readyJobs: 0,
  activeJobs: 0,
  failedJobs: 0,
  deadLetters: 0,
  queueLagSeconds: 0,
});

/** Persist one complete snapshot. No job name, identifier or payload is stored. */
export async function publishJobRuntimePulse(pulse: JobRuntimePulse): Promise<void> {
  const now = new Date();
  const stoppedAt = pulse.state === "stopped" ? now : null;
  await db()
    .insert(jobRuntimeHeartbeats)
    .values({
      ...pulse,
      platformVersion: PLATFORM_VERSION,
      heartbeatAt: now,
      stoppedAt,
      lastErrorCode: pulse.lastErrorCode ?? null,
      lastErrorAt: pulse.lastErrorAt ?? null,
    })
    .onConflictDoUpdate({
      target: jobRuntimeHeartbeats.instanceId,
      set: {
        role: pulse.role,
        state: pulse.state,
        platformVersion: PLATFORM_VERSION,
        registeredJobs: pulse.registeredJobs,
        mountedWorkers: pulse.mountedWorkers,
        scheduledJobs: pulse.scheduledJobs,
        queuedJobs: pulse.queuedJobs,
        readyJobs: pulse.readyJobs,
        activeJobs: pulse.activeJobs,
        failedJobs: pulse.failedJobs,
        deadLetters: pulse.deadLetters,
        queueLagSeconds: pulse.queueLagSeconds,
        lastErrorCode: pulse.lastErrorCode ?? null,
        lastErrorAt: pulse.lastErrorAt ?? null,
        heartbeatAt: now,
        stoppedAt,
      },
    });

  // Bounded operational evidence, not an immortal instance registry.
  await db()
    .delete(jobRuntimeHeartbeats)
    .where(
      lt(
        jobRuntimeHeartbeats.heartbeatAt,
        sql`now() - make_interval(days => ${HEARTBEAT_RETENTION_DAYS})`,
      ),
    );
}

interface RuntimeRow extends JobRuntimeMetrics {
  role: JobRuntimeRole;
  state: JobRuntimeState;
  platformVersion: string;
  heartbeatAgeSeconds: number;
  lastErrorCode: string | null;
}

function maximum(rows: RuntimeRow[], field: keyof JobRuntimeMetrics): number {
  return rows.reduce((value, row) => Math.max(value, row[field]), 0);
}

/**
 * Reduce durable rows without exposing instance ids or accepting host clock
 * skew. `heartbeatAgeSeconds` is computed by Postgres before this function.
 */
export function summarizeJobRuntimeEvidence(
  rows: RuntimeRow[],
  staleInstancesOverride?: number,
): JobRuntimeEvidence {
  const live = rows.filter(
    (row) =>
      row.heartbeatAgeSeconds <= JOB_HEARTBEAT_STALE_SECONDS &&
      row.state !== "stopping" &&
      row.state !== "stopped",
  );
  const producers = live.filter((row) => row.role === "producer").length;
  const workers = live.filter((row) => row.role === "worker");
  const currentWorkers = workers.filter(
    (row) => row.platformVersion === PLATFORM_VERSION,
  );
  const readyWorkers = currentWorkers.filter((row) => row.state === "ready");
  const metricRows = currentWorkers.length > 0 ? currentWorkers : workers;
  const newestWorker = [...currentWorkers].sort(
    (left, right) => left.heartbeatAgeSeconds - right.heartbeatAgeSeconds,
  )[0];

  const metrics: JobRuntimeMetrics = {
    registeredJobs: maximum(metricRows, "registeredJobs"),
    mountedWorkers: maximum(metricRows, "mountedWorkers"),
    scheduledJobs: maximum(metricRows, "scheduledJobs"),
    queuedJobs: maximum(metricRows, "queuedJobs"),
    readyJobs: maximum(metricRows, "readyJobs"),
    activeJobs: maximum(metricRows, "activeJobs"),
    failedJobs: maximum(metricRows, "failedJobs"),
    deadLetters: maximum(metricRows, "deadLetters"),
    queueLagSeconds: maximum(metricRows, "queueLagSeconds"),
  };
  const common = {
    ...metrics,
    producers,
    workers: workers.length,
    currentVersionWorkers: currentWorkers.length,
    staleInstances: staleInstancesOverride ?? rows.length - live.length,
    heartbeatAgeSeconds: newestWorker?.heartbeatAgeSeconds ?? null,
    lastErrorCode: newestWorker?.lastErrorCode ?? null,
  };

  if (live.length === 0) {
    return { ...common, ready: false, state: "unavailable", reason: "no_live_producer" };
  }
  if (workers.length === 0) {
    return { ...common, ready: false, state: "unavailable", reason: "no_live_worker" };
  }
  if (currentWorkers.length === 0) {
    return {
      ...common,
      ready: false,
      state: "unavailable",
      reason: "worker_version_mismatch",
    };
  }
  if (readyWorkers.length === 0) {
    const starting = currentWorkers.some((row) => row.state === "starting");
    return {
      ...common,
      ready: false,
      state: starting ? "starting" : "degraded",
      reason: starting ? "worker_starting" : "worker_degraded",
    };
  }
  const degraded = currentWorkers.some((row) => row.state === "degraded");
  return {
    ...common,
    ready: true,
    state: degraded || metrics.deadLetters > 0 ? "degraded" : "ready",
    reason: "ready",
  };
}

/** Read the same cross-process evidence used by public readiness and Doctor. */
export async function getJobRuntimeEvidence(): Promise<JobRuntimeEvidence> {
  if (!env().DATABASE_URL) {
    return {
      ...EMPTY_JOB_RUNTIME_METRICS,
      ready: true,
      state: "disabled",
      reason: "database_unconfigured",
      producers: 0,
      workers: 0,
      currentVersionWorkers: 0,
      staleInstances: 0,
      heartbeatAgeSeconds: null,
      lastErrorCode: null,
    };
  }

  const liveRows = await db()
    .select({
      role: jobRuntimeHeartbeats.role,
      state: jobRuntimeHeartbeats.state,
      platformVersion: jobRuntimeHeartbeats.platformVersion,
      registeredJobs: jobRuntimeHeartbeats.registeredJobs,
      mountedWorkers: jobRuntimeHeartbeats.mountedWorkers,
      scheduledJobs: jobRuntimeHeartbeats.scheduledJobs,
      queuedJobs: jobRuntimeHeartbeats.queuedJobs,
      readyJobs: jobRuntimeHeartbeats.readyJobs,
      activeJobs: jobRuntimeHeartbeats.activeJobs,
      failedJobs: jobRuntimeHeartbeats.failedJobs,
      deadLetters: jobRuntimeHeartbeats.deadLetters,
      queueLagSeconds: jobRuntimeHeartbeats.queueLagSeconds,
      lastErrorCode: jobRuntimeHeartbeats.lastErrorCode,
      heartbeatAgeSeconds: sql<number>`greatest(0, floor(extract(epoch from (now() - ${jobRuntimeHeartbeats.heartbeatAt}))))::int`,
    })
    .from(jobRuntimeHeartbeats)
    .where(sql`
      ${jobRuntimeHeartbeats.heartbeatAt} >= now() - make_interval(secs => ${JOB_HEARTBEAT_STALE_SECONDS})
      and ${jobRuntimeHeartbeats.state} not in ('stopping', 'stopped')
    `)
    .orderBy(desc(jobRuntimeHeartbeats.heartbeatAt));
  const [inventory] = await db()
    .select({
      staleInstances: sql<number>`count(*) filter (
        where ${jobRuntimeHeartbeats.heartbeatAt} < now() - make_interval(secs => ${JOB_HEARTBEAT_STALE_SECONDS})
          or ${jobRuntimeHeartbeats.state} in ('stopping', 'stopped')
      )::int`,
    })
    .from(jobRuntimeHeartbeats);

  return summarizeJobRuntimeEvidence(
    liveRows,
    inventory?.staleInstances ?? 0,
  );
}
