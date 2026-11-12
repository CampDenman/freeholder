// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Executed by the actual source test in a fresh process, never by inventory.
import { startVitest } from "vitest/node";

const fixture = "tests/fixtures/import-resumption.probe.ts";
const runner = await startVitest([fixture], { config: "vitest.config.ts", run: true, watch: false }, { test: { include: [fixture] } });
try {
  const files = runner.state.getFiles();
  if (files.length !== 1 || files[0].result?.state !== "pass") process.exitCode = 1;
} finally {
  await runner.close();
}
