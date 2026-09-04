// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Transactional background work (MASTER.md §9, §11 and §43 C1.09).
//
// pg-boss is the queue and Postgres is the only coordination service. A job
// caused by a business mutation is inserted through pg-boss's Drizzle adapter
// on the caller's transaction: the business row, idempotency claim and queue
// row therefore commit together or do not exist at all.
import { createHash, randomUUID } from "node:crypto";
import { and, eq, lt, sql } from "drizzle-orm";
import {
  PgBoss,
  fromDrizzle,
  type JobWithMetadata,
  type Db as PgBossDatabase,
  type QueueOptions,
  type SendOptions,
} from "pg-boss";
import { db, type Database } from "@/core/db";
import { databaseUrl, env } from "@/core/env";
import {
  EMPTY_JOB_RUNTIME_METRICS,
  JOB_HEARTBEAT_INTERVAL_MS,
  JOB_QUEUE_LAG_DEGRADED_SECONDS,
  publishJobRuntimePulse,
  type JobRuntimeMetrics,
  type JobRuntimeRole,
  type JobRuntimeState,
} from "@/core/jobs/health";
import { jobIdempotencyKeys } from "@/core/jobs/schema";

type JobTx = Parameters<Parameters<Database["transaction"]>[0]>[0];

const DAY_SECONDS = 24 * 60 * 60;
export const DEAD_LETTER_QUEUE = "core.deadLetter";

export type JobState =
  | "created"
  | "retry"
  | "active"
  | "completed"
  | "cancelled"
  | "failed";

export type JobHistoryRow = JobWithMetadata<Record<string, unknown>> & {
  stuck: boolean;
};

export interface JobHistoryQuery {
  name?: string;
  state?: JobState;
  limit?: number;
  offset?: number;
}

export interface JobOperationalSummary {
  queued: number;
  active: number;
  completed: number;
  cancelled: number;
  failed: number;
  deadLetters: number;
  stuck: number;
  total: number;
}

export interface JobRetryPolicy {
  /** Retries after the first attempt. */
  limit: number;
  /** Initial delay before retrying. */
  delaySeconds: number;
  /** Exponential delay with jitter rather than a fixed interval. */
  backoff: boolean;
  /** Hard ceiling for exponential delay. */
  maxDelaySeconds: number;
}

export interface JobExecutionContext {
  id: string;
  name: string;
  /** One for the first execution, then one more for each retry. */
  attempt: number;
  /** Aborted when this worker is shutting down. */
  signal: AbortSignal;
  leaseSeconds: number;
  /** Refresh the database lease and report whether the job is still live. */
  heartbeat: () => Promise<boolean>;
  /** Cancellation is durable; long handlers check at safe interruption points. */
  isCancelled: () => Promise<boolean>;
  throwIfCancelled: () => Promise<void>;
}

/** What a job is. Operational policy belongs beside the handler. */
export interface JobDefinition {
  /** Dotted, like a service: "core.sweepSessions". */
  name: string;
  summary: string;
  /** Cron, in UTC. Absent means the job only runs when explicitly enqueued. */
  schedule?: string;
  retry?: Partial<JobRetryPolicy>;
  /** Global maximum for this queue, coordinated in Postgres across replicas. */
  concurrency?: number;
  /** A lost worker releases the job after this many seconds. */
  leaseSeconds?: number;
  /** How long terminal pg-boss rows remain inspectable. */
  historySeconds?: number;
  handler: (
    data: Record<string, unknown>,
    context?: JobExecutionContext,
  ) => Promise<unknown>;
}

export interface ResolvedJobPolicy {
  retry: JobRetryPolicy;
  concurrency: number;
  leaseSeconds: number;
  heartbeatSeconds: number;
  historySeconds: number;
}

export interface EnqueueJobOptions {
  /** Opaque logical-operation key, unique within this job name. */
  idempotencyKey?: string;
  /** How long the key continues suppressing duplicates. Defaults to 30 days. */
  idempotencyTtlSeconds?: number;
  startAfter?: number | string | Date;
  priority?: number;
}

export interface EnqueuedJob {
  id: string;
  name: string;
  deduplicated: boolean;
}

export class JobContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JobContractError";
  }
}

export class JobCancelledError extends Error {
  constructor(id: string) {
    super(`Job ${id} was cancelled.`);
    this.name = "JobCancelledError";
  }
}

function integerInRange(value: number, name: string, min: number, max: number): void {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new JobContractError(`${name} must be an integer from ${min} to ${max}.`);
  }
}

function validateJob(job: JobDefinition): void {
  if (job.name === DEAD_LETTER_QUEUE) {
    throw new JobContractError(`Job name "${DEAD_LETTER_QUEUE}" is reserved for recovery.`);
  }
  if (!/^[a-z][A-Za-z0-9]*(\.[A-Za-z][A-Za-z0-9]*)+$/.test(job.name)) {
    throw new JobContractError(`Job name "${job.name}" must be dotted and stable.`);
  }
  if (!job.summary.trim()) throw new JobContractError(`Job "${job.name}" needs a summary.`);
  if (job.schedule && job.schedule.trim().split(/\s+/).length !== 5) {
    throw new JobContractError(`Job "${job.name}" must use a five-field cron expression.`);
  }
  if (job.concurrency !== undefined) integerInRange(job.concurrency, "concurrency", 1, 100);
  if (job.leaseSeconds !== undefined) integerInRange(job.leaseSeconds, "leaseSeconds", 30, 86_400);
  if (job.historySeconds !== undefined) {
    integerInRange(job.historySeconds, "historySeconds", 60, 365 * DAY_SECONDS);
  }
  if (job.retry?.limit !== undefined) integerInRange(job.retry.limit, "retry.limit", 0, 100);
  if (job.retry?.delaySeconds !== undefined) {
    integerInRange(job.retry.delaySeconds, "retry.delaySeconds", 0, DAY_SECONDS);
  }
  if (job.retry?.maxDelaySeconds !== undefined) {
    integerInRange(job.retry.maxDelaySeconds, "retry.maxDelaySeconds", 1, 30 * DAY_SECONDS);
  }
}

export function defineJob(job: JobDefinition): JobDefinition {
  validateJob(job);
  return job;
}

export function resolvedJobPolicy(job: JobDefinition): ResolvedJobPolicy {
  const leaseSeconds = job.leaseSeconds ?? 15 * 60;
  const delaySeconds = job.retry?.delaySeconds ?? 30;
  const maxDelaySeconds = job.retry?.maxDelaySeconds ?? 60 * 60;
  if (maxDelaySeconds < Math.max(1, delaySeconds)) {
    throw new JobContractError(
      `Job "${job.name}" retry.maxDelaySeconds cannot be shorter than its initial delay.`,
    );
  }
  return {
    retry: {
      limit: job.retry?.limit ?? 5,
      delaySeconds,
      backoff: job.retry?.backoff ?? true,
      maxDelaySeconds,
    },
    concurrency: job.concurrency ?? 1,
    leaseSeconds,
    heartbeatSeconds: Math.max(10, Math.min(60, Math.floor(leaseSeconds / 3))),
    historySeconds: job.historySeconds ?? 30 * DAY_SECONDS,
  };
}

const registry = new Map<string, JobDefinition>();
const mountedQueues = new Set<string>();
const mountedWorkers = new Set<string>();

export function registerJob(job: JobDefinition): void {
  validateJob(job);
  const existing = registry.get(job.name);
  if (existing === job) return;
  if (existing) throw new Error(`job "${job.name}" registered twice by two definitions`);
  registry.set(job.name, job);
  mountedQueues.delete(job.name);
  mountedWorkers.delete(job.name);
}

export function listJobs(): ReadonlyMap<string, JobDefinition> {
  return registry;
}

function definition(name: string): JobDefinition {
  const job = registry.get(name);
  if (!job) throw new JobContractError(`Job "${name}" is not registered.`);
  return job;
}

function workersEnabled(): boolean {
  if (env().FREEHOLDER_JOBS === "off") return false;
  if (process.env.NEXT_PHASE === "phase-production-build") return false;
  if (env().NODE_ENV === "test" && env().FREEHOLDER_JOBS !== "on") return false;
  return Boolean(env().DATABASE_URL);
}

function producerEnabled(): boolean {
  if (process.env.NEXT_PHASE === "phase-production-build") return false;
  return Boolean(env().DATABASE_URL);
}

function schedulesEnabled(): boolean {
  return workersEnabled() && env().NODE_ENV !== "test";
}

function queueOptions(job: JobDefinition): QueueOptions {
  const policy = resolvedJobPolicy(job);
  const options: QueueOptions = {
    retryLimit: policy.retry.limit,
    retryDelay: policy.retry.delaySeconds,
    retryBackoff: policy.retry.backoff,
    expireInSeconds: policy.leaseSeconds,
    heartbeatSeconds: policy.heartbeatSeconds,
    retentionSeconds: 30 * DAY_SECONDS,
    deleteAfterSeconds: policy.historySeconds,
  };
  if (policy.retry.backoff) options.retryDelayMax = policy.retry.maxDelaySeconds;
  return options;
}

const deadLetterOptions: QueueOptions = {
  retryLimit: 0,
  retryDelay: 0,
  retryBackoff: false,
  expireInSeconds: 15 * 60,
  heartbeatSeconds: 60,
  retentionSeconds: 90 * DAY_SECONDS,
  deleteAfterSeconds: 90 * DAY_SECONDS,
};

function executionOptions(
  job: JobDefinition,
  input: EnqueueJobOptions = {},
): SendOptions {
  const policy = resolvedJobPolicy(job);
  const options: SendOptions = {
    ...queueOptions(job),
    // One shared group gives pg-boss a database-coordinated limit for the
    // entire queue, not merely a per-process localConcurrency setting.
    group: { id: job.name },
    deadLetter: DEAD_LETTER_QUEUE,
    expireInSeconds: policy.leaseSeconds,
    heartbeatSeconds: policy.heartbeatSeconds,
  };
  if (input.priority !== undefined) options.priority = input.priority;
  if (input.startAfter !== undefined) options.startAfter = input.startAfter;
  return options;
}

let boss: PgBoss | undefined;
let producerStarting: Promise<PgBoss | undefined> | undefined;
let runtimeInstanceId: string | undefined;
let runtimeHeartbeatTimer: NodeJS.Timeout | undefined;
let runtimePulseInFlight: Promise<void> | undefined;
let runtimeLastMetrics: JobRuntimeMetrics = { ...EMPTY_JOB_RUNTIME_METRICS };
let runtimeLastErrorCode: string | undefined;
let runtimeLastErrorAt: Date | undefined;
let runtimeLastLogCode: string | undefined;
let runtimeLastLogAt = 0;
let runtimeLastAlert: "healthy" | "lag" | "dead_letters" = "healthy";

const RUNTIME_ERROR_RECOVERY_MS = JOB_HEARTBEAT_INTERVAL_MS * 2;
const RUNTIME_LOG_THROTTLE_MS = 60_000;

/** Stable, bounded diagnostics only; never return an error message or payload. */
export function jobRuntimeErrorCode(error: unknown): string {
  let current: unknown = error;
  for (let depth = 0; current && depth < 5; depth += 1) {
    const candidate = current as { code?: unknown; name?: unknown; cause?: unknown };
    if (
      typeof candidate.code === "string" &&
      /^[A-Za-z0-9_.-]{1,80}$/.test(candidate.code)
    ) {
      return candidate.code;
    }
    if (
      typeof candidate.name === "string" &&
      /^[A-Za-z][A-Za-z0-9_.-]{0,79}$/.test(candidate.name) &&
      candidate.name !== "Error"
    ) {
      return candidate.name;
    }
    current = candidate.cause;
  }
  return "runtime_error";
}

function logRuntimeFailure(phase: string, error: unknown): string {
  const code = jobRuntimeErrorCode(error);
  const now = Date.now();
  if (code !== runtimeLastLogCode || now - runtimeLastLogAt >= RUNTIME_LOG_THROTTLE_MS) {
    // Error messages may contain SQL values or provider responses. The stable
    // code and phase are actionable without risking a payload in platform logs.
    console.error(`[jobs] ${phase} failed; code=${code}; runtime health is degraded`);
    runtimeLastLogCode = code;
    runtimeLastLogAt = now;
  }
  return code;
}

function rememberRuntimeFailure(phase: string, error: unknown): void {
  runtimeLastErrorCode = logRuntimeFailure(phase, error);
  runtimeLastErrorAt = new Date();
}

function integerMetric(value: number | string | null | undefined): number {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

async function collectRuntimeMetrics(instance: PgBoss): Promise<JobRuntimeMetrics> {
  const queues = await instance.getQueues([...registry.keys(), DEAD_LETTER_QUEUE]);
  const ordinary = queues.filter((queue) => queue.name !== DEAD_LETTER_QUEUE);
  const deadLetter = queues.find((queue) => queue.name === DEAD_LETTER_QUEUE);
  const lagRows = await db().execute(sql`
    select
      count(*)::int as ready_jobs,
      coalesce(
        greatest(0, floor(extract(epoch from (now() - min(start_after)))))::int,
        0
      ) as queue_lag_seconds
    from pgboss.job
    where state in ('created'::pgboss.job_state, 'retry'::pgboss.job_state)
      and not blocked
      and start_after <= now()
      and name <> ${DEAD_LETTER_QUEUE}
  `);
  const lag = (lagRows[0] ?? {}) as {
    queue_lag_seconds?: number | string;
    ready_jobs?: number | string;
  };
  const sum = (
    field: "queuedCount" | "readyCount" | "activeCount" | "failedCount",
  ) => ordinary.reduce((total, queue) => total + integerMetric(queue[field]), 0);

  return {
    registeredJobs: registry.size,
    mountedWorkers: mountedWorkers.size,
    scheduledJobs: [...registry.values()].filter((job) => job.schedule).length,
    queuedJobs: sum("queuedCount"),
    readyJobs: integerMetric(lag.ready_jobs),
    activeJobs: sum("activeCount"),
    failedJobs: sum("failedCount"),
    deadLetters: integerMetric(deadLetter?.queuedCount),
    queueLagSeconds: integerMetric(lag.queue_lag_seconds),
  };
}

function runtimeRole(): JobRuntimeRole {
  return mountedWorkers.size > 0 ? "worker" : "producer";
}

function runtimeStateFor(metrics: JobRuntimeMetrics): {
  state: JobRuntimeState;
  errorCode?: string;
  errorAt?: Date;
} {
  if (
    metrics.readyJobs > 0 &&
    metrics.queueLagSeconds >= JOB_QUEUE_LAG_DEGRADED_SECONDS
  ) {
    return { state: "degraded", errorCode: "queue_lag", errorAt: new Date() };
  }
  if (
    runtimeLastErrorAt &&
    Date.now() - runtimeLastErrorAt.getTime() < RUNTIME_ERROR_RECOVERY_MS
  ) {
    return {
      state: "degraded",
      errorCode: runtimeLastErrorCode,
      errorAt: runtimeLastErrorAt,
    };
  }
  runtimeLastErrorCode = undefined;
  runtimeLastErrorAt = undefined;
  return { state: "ready" };
}

function reportRuntimeBacklog(metrics: JobRuntimeMetrics): void {
  const alert =
    metrics.readyJobs > 0 &&
    metrics.queueLagSeconds >= JOB_QUEUE_LAG_DEGRADED_SECONDS
      ? "lag"
      : metrics.deadLetters > 0
        ? "dead_letters"
        : "healthy";
  if (alert === runtimeLastAlert) return;
  runtimeLastAlert = alert;
  if (alert === "lag") {
    console.error(
      `[jobs] queue lag degraded; ready_jobs=${metrics.readyJobs}; queue_lag_seconds=${metrics.queueLagSeconds}`,
    );
  } else if (alert === "dead_letters") {
    console.error(`[jobs] dead-letter backlog; dead_letters=${metrics.deadLetters}`);
  } else {
    console.info("[jobs] runtime backlog recovered");
  }
}

async function pulseJobRuntime(
  instance: PgBoss,
  requestedState?: "starting" | "stopping" | "stopped",
): Promise<void> {
  runtimeInstanceId ??= randomUUID();
  const metrics = requestedState === "stopped"
    ? runtimeLastMetrics
    : await collectRuntimeMetrics(instance);
  runtimeLastMetrics = metrics;
  reportRuntimeBacklog(metrics);
  const derived = requestedState
    ? { state: requestedState as JobRuntimeState }
    : runtimeStateFor(metrics);
  await publishJobRuntimePulse({
    instanceId: runtimeInstanceId,
    role: runtimeRole(),
    ...metrics,
    state: derived.state,
    lastErrorCode: derived.errorCode,
    lastErrorAt: derived.errorAt,
  });
}

function scheduleRuntimePulse(instance: PgBoss): void {
  if (runtimePulseInFlight) return;
  runtimePulseInFlight = pulseJobRuntime(instance)
    .catch((error: unknown) => rememberRuntimeFailure("heartbeat", error))
    .finally(() => {
      runtimePulseInFlight = undefined;
    });
}

async function startRuntimeHeartbeat(instance: PgBoss): Promise<void> {
  await pulseJobRuntime(instance, "starting");
  if (runtimeHeartbeatTimer) return;
  runtimeHeartbeatTimer = setInterval(
    () => scheduleRuntimePulse(instance),
    JOB_HEARTBEAT_INTERVAL_MS,
  );
  runtimeHeartbeatTimer.unref();
}

async function ensureQueue(instance: PgBoss, job: JobDefinition): Promise<void> {
  if (mountedQueues.has(job.name)) return;
  const options = queueOptions(job);
  const existing = await instance.getQueue(job.name);
  if (existing) await instance.updateQueue(job.name, { ...options, deadLetter: DEAD_LETTER_QUEUE });
  else {
    await instance.createQueue(job.name, options);
    await instance.updateQueue(job.name, { deadLetter: DEAD_LETTER_QUEUE });
  }
  if (job.schedule && schedulesEnabled()) {
    await instance.schedule(job.name, job.schedule, {}, executionOptions(job));
  }
  mountedQueues.add(job.name);
}

async function ensureDeadLetterQueue(instance: PgBoss): Promise<void> {
  if (mountedQueues.has(DEAD_LETTER_QUEUE)) return;
  const existing = await instance.getQueue(DEAD_LETTER_QUEUE);
  if (existing) await instance.updateQueue(DEAD_LETTER_QUEUE, deadLetterOptions);
  else await instance.createQueue(DEAD_LETTER_QUEUE, deadLetterOptions);
  mountedQueues.add(DEAD_LETTER_QUEUE);
}

/**
 * Start pg-boss's producer and install queue policies without mounting a
 * handler in this process. Dedicated-web deployments still need this half so
 * request transactions can enqueue work for the separate worker.
 */
export async function startJobProducer(): Promise<PgBoss | undefined> {
  if (!producerEnabled()) return undefined;
  if (boss) return boss;
  producerStarting ??= (async () => {
    const instance = new PgBoss({
      connectionString: databaseUrl(),
      schema: "pgboss",
      max: 2,
      supervise: workersEnabled(),
      schedule: schedulesEnabled(),
    });
    instance.on("error", (error) => {
      rememberRuntimeFailure("pg-boss", error);
      scheduleRuntimePulse(instance);
    });
    try {
      await instance.start();
      await ensureDeadLetterQueue(instance);
      for (const job of registry.values()) await ensureQueue(instance, job);
      await startRuntimeHeartbeat(instance);
      boss = instance;
      return instance;
    } catch (error) {
      await instance.stop({ graceful: false }).catch(() => undefined);
      throw error;
    }
  })().catch((error) => {
    producerStarting = undefined;
    throw error;
  });
  return producerStarting;
}

function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new JobContractError("Job payload numbers must be finite.");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item === undefined ? null : item)).join(",")}]`;
  }
  if (typeof value === "object" && value) {
    return `{${Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  throw new JobContractError("Job payloads must be JSON-serializable values.");
}

function hashPayload(data: Record<string, unknown>): string {
  return createHash("sha256").update(canonicalJson(data)).digest("hex");
}

/**
 * pg-boss's Drizzle adapter expects `execute()` to return `{ rows }`, while
 * drizzle-orm/postgres-js returns the rows array directly. Normalize our
 * concrete driver before handing it to the upstream placeholder adapter.
 */
function transactionDatabase(tx: JobTx): PgBossDatabase {
  const normalized = {
    execute: async (query: unknown) => {
      const result = await (tx.execute as (input: unknown) => Promise<unknown>)(query);
      if (
        Array.isArray(result) &&
        (result.length === 0 ||
          typeof result[0] !== "object" ||
          result[0] === null ||
          !("rows" in result[0]))
      ) {
        return { rows: result };
      }
      return result as { rows: unknown[] } | Array<{ rows: unknown[] }>;
    },
  };
  return fromDrizzle(normalized, sql);
}

function validateEnqueueOptions(options: EnqueueJobOptions): void {
  if (options.idempotencyKey !== undefined) {
    const bytes = Buffer.byteLength(options.idempotencyKey, "utf8");
    if (!options.idempotencyKey.trim() || bytes > 200) {
      throw new JobContractError("idempotencyKey must be 1 to 200 UTF-8 bytes and not blank.");
    }
  }
  if (options.idempotencyTtlSeconds !== undefined) {
    integerInRange(
      options.idempotencyTtlSeconds,
      "idempotencyTtlSeconds",
      60,
      365 * DAY_SECONDS,
    );
  }
  if (options.priority !== undefined) integerInRange(options.priority, "priority", -10_000, 10_000);
}

/**
 * Enqueue through the transaction that caused the work.
 *
 * This is intentionally the only send primitive exported by core. A caller
 * that has no transaction opens one; it never gets a tempting best-effort
 * function capable of losing work between commit and enqueue.
 */
export async function enqueueJob(
  tx: JobTx,
  name: string,
  data: Record<string, unknown> = {},
  options: EnqueueJobOptions = {},
): Promise<EnqueuedJob> {
  validateEnqueueOptions(options);
  const job = definition(name);
  const instance = await startJobProducer();
  if (!instance) {
    throw new JobContractError("Background job storage is unavailable because DATABASE_URL is not configured.");
  }
  await ensureQueue(instance, job);

  const adapter = transactionDatabase(tx);
  const payloadHash = hashPayload(data);
  let jobId: string = randomUUID();

  if (options.idempotencyKey) {
    const ttl = options.idempotencyTtlSeconds ?? 30 * DAY_SECONDS;
    await tx
      .delete(jobIdempotencyKeys)
      .where(
        and(
          eq(jobIdempotencyKeys.jobName, name),
          eq(jobIdempotencyKeys.idempotencyKey, options.idempotencyKey),
          lt(jobIdempotencyKeys.expiresAt, sql`now()`),
        ),
      );

    const [claim] = await tx
      .insert(jobIdempotencyKeys)
      .values({
        jobName: name,
        idempotencyKey: options.idempotencyKey,
        payloadHash,
        jobId,
        // Database time keeps the invariant sound when an app host's clock is
        // skewed from Postgres—the queue already treats Postgres as its clock.
        expiresAt: sql`now() + make_interval(secs => ${ttl})`,
      })
      .onConflictDoNothing({
        target: [jobIdempotencyKeys.jobName, jobIdempotencyKeys.idempotencyKey],
      })
      .returning({ jobId: jobIdempotencyKeys.jobId });

    if (!claim) {
      const [existing] = await tx
        .select({
          jobId: jobIdempotencyKeys.jobId,
          payloadHash: jobIdempotencyKeys.payloadHash,
        })
        .from(jobIdempotencyKeys)
        .where(
          and(
            eq(jobIdempotencyKeys.jobName, name),
            eq(jobIdempotencyKeys.idempotencyKey, options.idempotencyKey),
          ),
        )
        .limit(1);
      if (!existing) throw new JobContractError("The idempotency claim changed concurrently; retry.");
      if (existing.payloadHash !== payloadHash) {
        throw new JobContractError(
          `Idempotency key "${options.idempotencyKey}" was already used for different job data.`,
        );
      }
      return { id: existing.jobId, name, deduplicated: true };
    }
    jobId = claim.jobId;
  }

  const inserted = await instance.send(name, data, {
    ...executionOptions(job, options),
    id: jobId,
    db: adapter,
  });
  if (inserted !== jobId) {
    throw new JobContractError(`pg-boss refused transactional enqueue for "${name}".`);
  }
  return { id: jobId, name, deduplicated: false };
}

function stateReader(instance: PgBoss, name: string, id: string) {
  return async (): Promise<JobWithMetadata<Record<string, unknown>> | undefined> =>
    (await instance.findJobs<Record<string, unknown>>(name, { id }))[0];
}

/** Start every registered handler. Safe to call more than once. */
export async function startJobs(): Promise<PgBoss | undefined> {
  const instance = await startJobProducer();
  if (!instance || !workersEnabled()) return instance;

  for (const job of registry.values()) {
    await ensureQueue(instance, job);
    if (mountedWorkers.has(job.name)) continue;
    const policy = resolvedJobPolicy(job);
    await instance.work<Record<string, unknown>>(
      job.name,
      {
        includeMetadata: true,
        localConcurrency: policy.concurrency,
        groupConcurrency: policy.concurrency,
      },
      async (messages) => {
        for (const message of messages) {
          const metadata = message as JobWithMetadata<Record<string, unknown>>;
          const readState = stateReader(instance, job.name, message.id);
          const isCancelled = async () => (await readState())?.state === "cancelled";
          const context: JobExecutionContext = {
            id: message.id,
            name: job.name,
            attempt: metadata.retryCount + 1,
            signal: message.signal,
            leaseSeconds: policy.leaseSeconds,
            heartbeat: async () => {
              await instance.touch(job.name, message.id);
              return !(await isCancelled());
            },
            isCancelled,
            throwIfCancelled: async () => {
              if (message.signal.aborted || (await isCancelled())) {
                throw new JobCancelledError(message.id);
              }
            },
          };
          await context.throwIfCancelled();
          await job.handler(message.data ?? {}, context);
        }
      },
    );
    mountedWorkers.add(job.name);
  }

  console.log(
    `[jobs] worker running: ${registry.size} job(s), ${
      [...registry.values()].filter((job) => job.schedule).length
    } scheduled`,
  );
  await pulseJobRuntime(instance);
  return instance;
}

/** Cancel queued/retrying work or mark active work for cooperative cancellation. */
export async function cancelJob(tx: JobTx, name: string, id: string): Promise<boolean> {
  definition(name);
  const instance = await startJobProducer();
  if (!instance) throw new JobContractError("Background job storage is unavailable.");
  const adapter = transactionDatabase(tx);
  const [current] = await instance.findJobs(name, { id, db: adapter });
  if (!current || ["completed", "failed", "cancelled"].includes(current.state)) return false;
  await instance.cancel(name, id, { db: adapter });
  return true;
}

/** Requeue a retained failed/cancelled job; the handler remains idempotent. */
export async function retryJob(tx: JobTx, name: string, id: string): Promise<boolean> {
  definition(name);
  const instance = await startJobProducer();
  if (!instance) throw new JobContractError("Background job storage is unavailable.");
  const adapter = transactionDatabase(tx);
  const [current] = await instance.findJobs(name, { id, db: adapter });
  if (!current || !["failed", "cancelled"].includes(current.state)) return false;
  if (current.state === "cancelled") await instance.resume(name, id, { db: adapter });
  else await instance.retry(name, id, { db: adapter });
  return true;
}

export async function getJob(
  name: string,
  id: string,
): Promise<JobWithMetadata<Record<string, unknown>> | null> {
  if (name !== DEAD_LETTER_QUEUE) definition(name);
  const instance = await startJobProducer();
  if (!instance) return null;
  return (await instance.findJobs<Record<string, unknown>>(name, { id }))[0] ?? null;
}

export function isJobStuck(
  job: JobWithMetadata<Record<string, unknown>>,
  now = new Date(),
): boolean {
  if (job.state !== "active") return false;
  const checkpoint = job.heartbeatOn ?? job.startedOn;
  if (!checkpoint) return false;
  const allowedSeconds = job.heartbeatSeconds || job.expireInSeconds;
  return checkpoint.getTime() + allowedSeconds * 1000 <= now.getTime();
}

function historyNames(name?: string): string[] {
  if (name) {
    if (name !== DEAD_LETTER_QUEUE) definition(name);
    return [name];
  }
  return [...registry.keys(), DEAD_LETTER_QUEUE];
}

async function retainedHistory(name?: string): Promise<JobHistoryRow[]> {
  const instance = await startJobProducer();
  if (!instance) return [];
  const batches = await Promise.all(
    historyNames(name).map((queue) =>
      instance.findJobs<Record<string, unknown>>(queue),
    ),
  );
  return batches
    .flat()
    .map((job) => ({ ...job, stuck: isJobStuck(job) }));
}

function activityTime(job: JobWithMetadata<Record<string, unknown>>): number {
  return (
    job.completedOn ??
    job.heartbeatOn ??
    job.startedOn ??
    job.createdOn
  ).getTime();
}

export async function listJobHistory(
  query: JobHistoryQuery = {},
): Promise<{ items: JobHistoryRow[]; total: number }> {
  const limit = query.limit ?? 50;
  const offset = query.offset ?? 0;
  integerInRange(limit, "limit", 1, 100);
  integerInRange(offset, "offset", 0, 1_000_000);
  const rows = (await retainedHistory(query.name))
    .filter((job) => !query.state || job.state === query.state)
    .sort((left, right) => activityTime(right) - activityTime(left));
  return { items: rows.slice(offset, offset + limit), total: rows.length };
}

export async function jobOperationalSummary(): Promise<JobOperationalSummary> {
  const rows = await retainedHistory();
  const ordinary = rows.filter((job) => job.name !== DEAD_LETTER_QUEUE);
  return {
    queued: ordinary.filter((job) => job.state === "created" || job.state === "retry").length,
    active: ordinary.filter((job) => job.state === "active").length,
    completed: ordinary.filter((job) => job.state === "completed").length,
    cancelled: ordinary.filter((job) => job.state === "cancelled").length,
    // A routed terminal failure remains in its source queue as immutable
    // history, but the corresponding DLQ row is the actionable copy. Counting
    // both would keep the briefing red forever after a successful redrive.
    failed: ordinary.filter((job) => job.state === "failed" && !job.deadLetter).length,
    deadLetters: rows.filter((job) => job.name === DEAD_LETTER_QUEUE).length,
    stuck: ordinary.filter((job) => job.stuck).length,
    total: rows.length,
  };
}

/** Move retained dead letters back to their original queue, oldest first. */
export async function redriveDeadLetters(
  tx: JobTx,
  input: { sourceName?: string; limit?: number } = {},
): Promise<number> {
  if (input.sourceName) definition(input.sourceName);
  const limit = input.limit ?? 1;
  integerInRange(limit, "limit", 1, 100);
  const instance = await startJobProducer();
  if (!instance) throw new JobContractError("Background job storage is unavailable.");
  return instance.redrive(DEAD_LETTER_QUEUE, {
    sourceName: input.sourceName,
    limit,
    db: transactionDatabase(tx),
  });
}

export async function pruneJobIdempotencyKeys(): Promise<number> {
  const removed = await db()
    .delete(jobIdempotencyKeys)
    .where(lt(jobIdempotencyKeys.expiresAt, sql`now()`))
    .returning({ id: jobIdempotencyKeys.id });
  return removed.length;
}

export async function stopJobs(): Promise<void> {
  const instance = boss ?? (await producerStarting?.catch(() => undefined));
  boss = undefined;
  producerStarting = undefined;
  if (runtimeHeartbeatTimer) clearInterval(runtimeHeartbeatTimer);
  runtimeHeartbeatTimer = undefined;
  await runtimePulseInFlight?.catch(() => undefined);
  runtimePulseInFlight = undefined;
  if (instance && runtimeInstanceId) {
    await pulseJobRuntime(instance, "stopping").catch((error: unknown) =>
      logRuntimeFailure("shutdown-heartbeat", error),
    );
  }
  await instance?.stop({ graceful: true, timeout: 30_000 });
  if (instance && runtimeInstanceId) {
    await pulseJobRuntime(instance, "stopped").catch((error: unknown) =>
      logRuntimeFailure("shutdown-heartbeat", error),
    );
  }
  mountedQueues.clear();
  mountedWorkers.clear();
  runtimeInstanceId = undefined;
  runtimeLastMetrics = { ...EMPTY_JOB_RUNTIME_METRICS };
  runtimeLastErrorCode = undefined;
  runtimeLastErrorAt = undefined;
  runtimeLastAlert = "healthy";
}
