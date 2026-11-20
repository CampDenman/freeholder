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
      const { initializePlayground } = await import("@/core/demo/playground");
      await initializePlayground();
      const { seedDemoIfRequested } = await import("@/modules/seed/boot");
      await seedDemoIfRequested();
      // C3.35: a launch spec, when the deploy names one (never alongside the demo).
      const { seedLaunchIfRequested } = await import("@/modules/seed/boot");
      await seedLaunchIfRequested();
      // C1.38: caps count what visitors add, not what the seed installed.
      const { markPlaygroundBaseline } = await import("@/core/demo/playground");
      await markPlaygroundBaseline();

      // Every definition exists before the worker mounts a queue.
      phase = "job runtime";
      const { startJobs } = await import("@/core/jobs");
      await startJobs();
      return;
    } catch (error) {
      // A dependency outage must keep liveness green and readiness red. Retry
      // idempotent initialization in-process so database recovery does not
      // require an operator restart. Never print the caught error's MESSAGE or
      // stack: SQL and provider errors may contain values that do not belong
      // in logs. A bounded code or class name carries no values, and it is the
      // difference between a diagnosable failure and a loop whose only output
      // is "retrying" -- which is exactly how the packaged-image and
      // native-install journeys failed in CI, with nothing to say why.
      const now = Date.now();
      if (attempt === 0 || now - lastFailureLogAt >= 60_000) {
        const cause = failureDiscriminator(error);
        console.error(
          `[freeholder] ${phase} unavailable${cause ? ` (${cause})` : ""}; readiness is unavailable; retrying`,
        );
        lastFailureLogAt = now;
      }
      if (runtimeAbort.signal.aborted) return;
      await wait(retryDelay(attempt), runtimeAbort.signal);
      attempt += 1;
    }
  }
}

/**
 * A failure's code, from anywhere in its cause chain, or its class name.
 *
 * Still never the message, the stack, or any other part of a cause: those
 * carry SQL fragments, connection strings and provider payloads. A `code` is a
 * fixed token by convention -- `42703` from PostgreSQL, `ECONNREFUSED` from
 * Node, a `ServiceError` code from this codebase -- so it is bounded here to a
 * short identifier charset rather than trusted to be one.
 *
 * The chain is walked because the database driver wraps. `DrizzleQueryError`
 * sets no `name` and no `code` and puts the real PostgresError in `cause`, so
 * reading only the outermost own `code` reported a migration refusal as plain
 * "Error" -- which is how a guard in migration 0086 that made every packaged
 * deploy unbootable survived three CI runs without naming itself. A wrapper's
 * class name must never outrank a real code underneath it, so every code in
 * the chain is preferred to the outer name. The walk is bounded and
 * cycle-safe, and reads properties without invoking accessors, because an
 * error object here is untrusted input.
 */
function failureDiscriminator(error: unknown): string | null {
  const seen = new Set<unknown>();
  for (let current: unknown = error; current !== null && typeof current === "object" && !seen.has(current) && seen.size < 4; ) {
    seen.add(current);
    const code = own(current, "code");
    if (typeof code === "string" && /^[A-Za-z0-9_.-]{1,64}$/.test(code)) return code;
    if (typeof code === "number" && Number.isInteger(code)) return String(code);
    current = own(current, "cause");
  }
  // `name` is read normally, not as an own property: Error keeps it on the
  // prototype, so an own-property read would quietly return nothing for every
  // ordinary Error and leave the log with no discriminator at all.
  let name: unknown;
  try {
    name = error !== null && typeof error === "object" ? (error as { name?: unknown }).name : undefined;
  } catch {
    name = undefined;
  }
  if (typeof name === "string" && /^[A-Za-z0-9_.-]{1,64}$/.test(name)) return name;
  return null;
}

/** An own data property's value, never a getter's return and never a throw. */
function own(target: object, key: string): unknown {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(target, key);
    return descriptor && "value" in descriptor ? descriptor.value : undefined;
  } catch {
    return undefined;
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
