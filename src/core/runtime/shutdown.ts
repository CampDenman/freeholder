// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// A small, testable process-shutdown coordinator. The framework-facing module
// owns signal registration; this file owns the once-only and deadline rules.

export type ShutdownSignal = "SIGINT" | "SIGTERM";

export interface GracefulShutdownOptions {
  drain: () => Promise<void>;
  exit: (code: number) => void;
  timeoutMs: number;
  log: (level: "info" | "error", message: string) => void;
}

export function signalExitCode(signal: ShutdownSignal): number {
  return signal === "SIGINT" ? 130 : 143;
}

export function createGracefulShutdown(options: GracefulShutdownOptions): {
  handle: (signal: ShutdownSignal) => Promise<void>;
  started: () => boolean;
} {
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
    throw new Error("shutdown timeout must be a positive number of milliseconds");
  }

  let operation: Promise<void> | undefined;
  const handle = (signal: ShutdownSignal): Promise<void> => {
    operation ??= (async () => {
      options.log("info", `[freeholder] ${signal} received; draining background work`);
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timedOut = new Promise<"timeout">((resolve) => {
        timer = setTimeout(() => resolve("timeout"), options.timeoutMs);
        timer.unref?.();
      });
      const result = await Promise.race([
        options.drain().then(() => "drained" as const),
        timedOut,
      ]).catch(() => "failed" as const);
      if (timer) clearTimeout(timer);

      if (result === "timeout") {
        options.log("error", "[freeholder] shutdown drain exceeded its deadline");
      } else if (result === "failed") {
        options.log("error", "[freeholder] shutdown drain failed");
      } else {
        options.log("info", "[freeholder] background work drained");
      }
      options.exit(result === "drained" ? signalExitCode(signal) : 1);
    })();
    return operation;
  };

  return { handle, started: () => operation !== undefined };
}
