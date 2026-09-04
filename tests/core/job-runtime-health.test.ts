// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { reviewMigration } from "../../scripts/schema-compat-gate.mjs";
import {
  JOB_HEARTBEAT_STALE_SECONDS,
  summarizeJobRuntimeEvidence,
} from "@/core/jobs/health";
import { PLATFORM_VERSION } from "@/core/platform";

const MIGRATION_PATH = "db/migrations/0154_job_runtime_health.sql";
const migration = readFileSync(MIGRATION_PATH, "utf8");

type RuntimeRow = Parameters<typeof summarizeJobRuntimeEvidence>[0][number];

function runtimeRow(overrides: Partial<RuntimeRow> = {}): RuntimeRow {
  return {
    role: "worker",
    state: "ready",
    platformVersion: PLATFORM_VERSION,
    registeredJobs: 12,
    mountedWorkers: 12,
    scheduledJobs: 4,
    queuedJobs: 3,
    readyJobs: 2,
    activeJobs: 1,
    failedJobs: 0,
    deadLetters: 0,
    queueLagSeconds: 7,
    heartbeatAgeSeconds: 2,
    lastErrorCode: null,
    ...overrides,
  };
}

describe("durable job runtime evidence", () => {
  it("ships one additive migration with every persisted health invariant", () => {
    expect(migration).toContain('CREATE TABLE "job_runtime_heartbeats"');
    expect(migration).toContain('CONSTRAINT "job_runtime_heartbeats_version_not_blank"');
    expect(migration).toContain('CONSTRAINT "job_runtime_heartbeats_error_code_length"');
    expect(reviewMigration(MIGRATION_PATH, migration)).toMatchObject({
      ok: true,
      breaking: [],
    });
    expect(migration).not.toMatch(/\b(?:DROP|RENAME|TRUNCATE)\b/i);
  });

  it("requires a fresh current-version worker, not merely a producer", () => {
    const producerOnly = summarizeJobRuntimeEvidence([
      runtimeRow({ role: "producer", mountedWorkers: 0 }),
    ]);
    expect(producerOnly).toMatchObject({
      ready: false,
      state: "unavailable",
      reason: "no_live_worker",
      producers: 1,
      workers: 0,
    });

    const oldWorker = summarizeJobRuntimeEvidence([
      runtimeRow({ platformVersion: "0.0.0-old" }),
    ]);
    expect(oldWorker).toMatchObject({
      ready: false,
      reason: "worker_version_mismatch",
      currentVersionWorkers: 0,
    });
  });

  it("refuses stale, starting and degraded-only workers", () => {
    expect(
      summarizeJobRuntimeEvidence([
        runtimeRow({ heartbeatAgeSeconds: JOB_HEARTBEAT_STALE_SECONDS + 1 }),
      ]),
    ).toMatchObject({ ready: false, reason: "no_live_producer", staleInstances: 1 });
    expect(
      summarizeJobRuntimeEvidence([runtimeRow({ state: "starting" })]),
    ).toMatchObject({ ready: false, state: "starting", reason: "worker_starting" });
    expect(
      summarizeJobRuntimeEvidence([
        runtimeRow({ state: "degraded", lastErrorCode: "queue_lag" }),
      ]),
    ).toMatchObject({
      ready: false,
      state: "degraded",
      reason: "worker_degraded",
      lastErrorCode: "queue_lag",
    });
  });

  it("reports aggregate payload-free queue metrics from live workers", () => {
    const evidence = summarizeJobRuntimeEvidence([
      runtimeRow(),
      runtimeRow({
        state: "degraded",
        readyJobs: 9,
        queueLagSeconds: 88,
        lastErrorCode: "transient_database_error",
      }),
    ]);
    expect(evidence).toMatchObject({
      ready: true,
      state: "degraded",
      reason: "ready",
      producers: 0,
      workers: 2,
      currentVersionWorkers: 2,
      readyJobs: 9,
      queueLagSeconds: 88,
    });
    expect(evidence).not.toHaveProperty("instanceId");
  });

  it("keeps a capable worker ready while surfacing dead letters as degraded", () => {
    expect(
      summarizeJobRuntimeEvidence([runtimeRow({ deadLetters: 2 })]),
    ).toMatchObject({
      ready: true,
      state: "degraded",
      deadLetters: 2,
    });
  });
});
