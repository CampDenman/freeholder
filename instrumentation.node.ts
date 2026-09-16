// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Node-only process bootstrap. The shared instrumentation entrypoint imports
// this module only after Next confirms that it is running the Node runtime.
import { createGracefulShutdown } from "@/core/runtime/shutdown";

const RETRY_MAX_MS = 30_000;
const SHUTDOWN_TIMEOUT_MS = 35_000;
let runtimeInitialization: Promise<void> | undefined;
let lastFailureLogAt = 0;
let shutdownInstalled = false;
let runtimeAbort = new AbortController();

function retryDelay(attempt: number): number {
  return Math.min(1_000 * 2 ** Math.min(attempt, 5), RETRY_MAX_MS);
}

function wait(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, milliseconds);
    timer.unref?.();
    signal.addEventListener("abort", done, { once: true });
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
  });
}

async function initializeRuntime(): Promise<void> {
  let attempt = 0;
  while (!runtimeAbort.signal.aborted) {
    let phase = "migration";
    try {
      // Before boot, and before the first request: a fresh deploy otherwise
      // starts against an empty database and answers 500 on every page.
      const { migrateToLatest } = await import("@/core/migrate");
      const result = await migrateToLatest();
      console.log(
        result.ran
          ? "[freeholder] schema is up to date"
          : `[freeholder] migrations skipped: ${result.reason}`,
      );

      phase = "module boot";
      const { bootOnce } = await import("@/core/boot");
      const { default: manifests } = await import("@/modules");
      await bootOnce(manifests);

      // Persist immutable manifest definitions after every module/plugin has
      // registered its contribution.
      phase = "onboarding synchronization";
      const { db } = await import("@/core/db");
      const { syncOnboardingDefinitions } = await import("@/core/demo/service");
      await db().transaction((tx) => syncOnboardingDefinitions(tx));

      phase = "demo seed";
      const { seedDemoIfRequested } = await import("@/modules/seed/boot");
      await seedDemoIfRequested();

      // Every definition exists before the worker mounts a queue.
      phase = "job runtime";
      const { startJobs } = await import("@/core/jobs");
      await startJobs();
      return;
    } catch {
      // A dependency outage must keep liveness green and readiness red. Retry
      // idempotent initialization in-process so database recovery does not
      // require an operator restart. Never print the caught error: SQL and
      // provider errors may contain values that do not belong in logs.
      const now = Date.now();
      if (attempt === 0 || now - lastFailureLogAt >= 60_000) {
        console.error(
          `[freeholder] ${phase} unavailable; readiness is unavailable; retrying`,
        );
        lastFailureLogAt = now;
      }
      if (runtimeAbort.signal.aborted) return;
      await wait(retryDelay(attempt), runtimeAbort.signal);
      attempt += 1;
    }
  }
}

export async function stopNodeRuntime(): Promise<void> {
  runtimeAbort.abort();
  await runtimeInitialization?.catch(() => undefined);
  const { stopJobs } = await import("@/core/jobs");
  await stopJobs();
  runtimeInitialization = undefined;
}

function installShutdownHandlers(): void {
  if (process.env.NEXT_MANUAL_SIG_HANDLE !== "true" || shutdownInstalled) return;
  shutdownInstalled = true;
  const shutdown = createGracefulShutdown({
    drain: stopNodeRuntime,
    exit: (code) => process.exit(code),
    timeoutMs: SHUTDOWN_TIMEOUT_MS,
    log: (level, message) => console[level](message),
  });
  process.once("SIGINT", () => void shutdown.handle("SIGINT"));
  process.once("SIGTERM", () => void shutdown.handle("SIGTERM"));
}

export function startNodeRuntime(): void {
  installShutdownHandlers();
  if (runtimeAbort.signal.aborted) runtimeAbort = new AbortController();
  runtimeInitialization ??= initializeRuntime();
}
