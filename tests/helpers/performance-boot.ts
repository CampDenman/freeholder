// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C11.11: cold-boot wall-clock — `pnpm start` process spawn to the first
// successful HTTP 200 on the health route, measured on the production build
// against the seeded fixture database. §15.1's row exists because "Replit and
// a restarted droplet both pay this on every deploy", so the measurement pays
// the real production boot path: migrations at boot, module graph, onboarding
// sync and the job runtime all included, with the database the run already
// migrated and seeded. The sample is process spawn → /api/health/live 200;
// afterwards the instance must also reach readiness (ok:true on /api/health)
// or the boot is failed, not passed.
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { connect } from "node:net";
import { resolve } from "node:path";
import { startJobs, stopJobs } from "@/core/jobs";
import { resetEnvForTests } from "@/core/env";
import { percentile } from "./performance";
import { waitForHttpOk } from "./performance-browser";

export interface BootMeasurement {
  surface: "Cold boot to serving";
  value: number;
  samples: number[];
  port: number;
}

/** Fail-closed capability check, kept pure so the contract tests can drive it. */
export function bootPrerequisites(input: {
  buildId: string;
  databaseUrl: string | undefined;
}): { ok: true } | { ok: false; reason: string } {
  if (!existsSync(input.buildId)) {
    return {
      ok: false,
      reason: `production build is missing (${input.buildId}); run pnpm build before requesting cold-boot clocks`,
    };
  }
  if (!input.databaseUrl) {
    return { ok: false, reason: "no DATABASE_URL for the boot server" };
  }
  return { ok: true };
}

export async function findFreePort(host: string, from = 3101, to = 3120): Promise<number> {
  for (let port = from; port <= to; port += 1) {
    const taken = await new Promise<boolean>((r) => {
      const socket = connect({ host, port });
      socket.once("connect", () => {
        socket.destroy();
        r(true);
      });
      socket.once("error", () => {
        socket.destroy();
        r(false);
      });
    });
    if (!taken) return port;
  }
  throw new Error(`No free port in ${from}–${to} for the cold-boot measurement.`);
}

async function stopProcessGroup(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  try {
    process.kill(-child.pid!, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
  const exited = await new Promise<boolean>((r) => {
    const timer = setTimeout(() => r(false), 20_000);
    child.once("exit", () => {
      clearTimeout(timer);
      r(true);
    });
  });
  if (!exited) {
    try {
      process.kill(-child.pid!, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
    await new Promise((r) => child.once("exit", r));
  }
}

async function readinessOk(baseUrl: string): Promise<boolean> {
  try {
    const response = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(2_000) });
    if (!response.ok) return false;
    const body = (await response.json()) as { ok?: boolean };
    return body.ok === true;
  } catch {
    return false;
  }
}

/**
 * Boot the production server ${boots} times and report the nearest-rank p95
 * of spawn → first HTTP 200 on /api/health/live. Every boot must then reach
 * readiness within 90 seconds or the measurement fails closed: a process that
 * answers liveness but never serves is not "serving".
 *
 * The pg-boss schema is warmed once in-process before the timed boots so
 * every sample pays the same job-runtime work — the first-ever boot on a
 * truly empty database would otherwise include a one-time schema install that
 * a restarted droplet never pays.
 */
export async function measureColdBoot(input: {
  boots: number;
  databaseUrl: string;
  env?: NodeJS.ProcessEnv;
  host?: string;
}): Promise<BootMeasurement> {
  if (!Number.isInteger(input.boots) || input.boots < 3) {
    throw new Error("Cold-boot measurement requires at least 3 boots (PERF_BOOT_SAMPLES).");
  }
  const host = input.host ?? "127.0.0.1";

  const priorJobs = process.env.FREEHOLDER_JOBS;
  process.env.FREEHOLDER_JOBS = "on";
  resetEnvForTests();
  try {
    const worker = await startJobs();
    if (!worker) throw new Error("Cold-boot warm-up could not start the job runtime.");
    await stopJobs();
  } finally {
    if (priorJobs === undefined) delete process.env.FREEHOLDER_JOBS;
    else process.env.FREEHOLDER_JOBS = priorJobs;
    resetEnvForTests();
  }

  const samples: number[] = [];
  let usedPort = 0;
  for (let boot = 0; boot < input.boots; boot += 1) {
    const port = await findFreePort(host);
    usedPort = port;
    const baseUrl = `http://${host}:${port}`;
    const child = spawn("pnpm", ["start"], {
      cwd: resolve("."),
      detached: true,
      env: {
        ...input.env,
        APP_URL: baseUrl,
        DATABASE_URL: input.databaseUrl,
        FREEHOLDER_JOBS: "on",
        FREEHOLDER_UNSAFE_LOCAL_STORAGE: "1",
        LOCAL_STORAGE_ROOT: "test-results/perf-boot-media",
        PORT: String(port),
        HOSTNAME: host,
      } as NodeJS.ProcessEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      output += chunk.toString();
      if (output.length > 20_000) output = output.slice(-20_000);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      output += chunk.toString();
      if (output.length > 20_000) output = output.slice(-20_000);
    });
    const started = performance.now();
    try {
      await waitForHttpOk(`${baseUrl}/api/health/live`, 120_000);
      const sample = performance.now() - started;
      if (!Number.isFinite(sample) || sample < 0) {
        throw new Error(`Cold-boot sample ${boot} produced an invalid timing.`);
      }
      samples.push(sample);
      const readinessDeadline = Date.now() + 90_000;
      while (!(await readinessOk(baseUrl))) {
        if (Date.now() > readinessDeadline) {
          throw new Error(
            `Boot ${boot} answered liveness but never reached readiness (ok:true on /api/health) within 90 seconds.`,
          );
        }
        await new Promise((r) => setTimeout(r, 250));
      }
    } catch (error) {
      throw new Error(
        `Cold-boot sample ${boot} failed: ${error instanceof Error ? error.message : String(error)}\n${output}`,
      );
    } finally {
      await stopProcessGroup(child);
    }
  }
  return {
    surface: "Cold boot to serving",
    value: Math.round(percentile(samples, 95)),
    samples: samples.map((sample) => Math.round(sample)),
    port: usedPort,
  };
}
