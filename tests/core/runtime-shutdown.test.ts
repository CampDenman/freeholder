// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  createGracefulShutdown,
  signalExitCode,
} from "@/core/runtime/shutdown";

describe("framework-owned graceful shutdown", () => {
  it("drains once and preserves signal exit semantics", async () => {
    const drain = vi.fn(async () => undefined);
    const exit = vi.fn();
    const shutdown = createGracefulShutdown({
      drain,
      exit,
      timeoutMs: 1_000,
      log: () => undefined,
    });

    await Promise.all([shutdown.handle("SIGTERM"), shutdown.handle("SIGINT")]);
    expect(shutdown.started()).toBe(true);
    expect(drain).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledOnce();
    expect(exit).toHaveBeenCalledWith(signalExitCode("SIGTERM"));
  });

  it("fails closed when draining exceeds the platform deadline", async () => {
    const exit = vi.fn();
    const logs: string[] = [];
    const shutdown = createGracefulShutdown({
      drain: () => new Promise(() => undefined),
      exit,
      timeoutMs: 5,
      log: (_level, message) => logs.push(message),
    });
    await shutdown.handle("SIGTERM");
    expect(exit).toHaveBeenCalledWith(1);
    expect(logs.at(-1)).toContain("exceeded");
  });

  it("gives Freeholder signal ownership before either Next entrypoint starts", () => {
    const launcher = source("scripts/start.mjs");
    const container = source("Dockerfile");
    const runtime = source("instrumentation.node.ts");
    expect(launcher.indexOf("NEXT_MANUAL_SIG_HANDLE")).toBeLessThan(
      launcher.indexOf('import("next/dist/bin/next")'),
    );
    expect(container).toContain("NEXT_MANUAL_SIG_HANDLE=true");
    expect(runtime).toContain('process.once("SIGTERM"');
    expect(runtime).toContain("drain: stopNodeRuntime");
  });
});

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}
