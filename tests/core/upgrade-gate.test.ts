// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C11.15: unavailable prior images cannot turn untested upgrades green.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";

it("retains forward migration and N-1 rollback checks (C10.07)", () => {
  const script = readFileSync("scripts/upgrade-gate.sh", "utf8");
  expect(script).toMatch(/the previous release boots and migrates an empty database/);
  expect(script).toMatch(/this build migrates that database forward/);
  expect(script).toMatch(/the data survived the migration/);
  expect(script).toMatch(/the previous release still runs against the new schema \(rollback\)/);
  expect(script).toMatch(/FREEHOLDER_SKIP_MIGRATE/);
  expect(script).toMatch(/home_rollback/);
  expect(script).toMatch(/N-1 schema is readable/);
});

it.skipIf(process.platform === "win32")("fails the upgrade gate when the prior image cannot be pulled", () => {
  const directory = mkdtempSync(join(tmpdir(), "freeholder-upgrade-gate-"));
  try {
    writeFileSync(join(directory, "docker"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
    const result = spawnSync("bash", [resolve("scripts/upgrade-gate.sh")], {
      env: { ...process.env, PATH: `${directory}:${process.env.PATH ?? ""}`,
        PREVIOUS_IMAGE: "ghcr.io/Example/freeholder:edge", CURRENT_IMAGE: "freeholder:ci" },
      encoding: "utf8", timeout: 10_000,
    });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("Upgrade gate blocked");
    expect(result.stdout).toContain("No upgrade or rollback was verified");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
