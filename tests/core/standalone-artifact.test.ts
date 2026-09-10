// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C10.26 build audit: repository metadata is not a production dependency.
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";

it("rejects repository metadata and scrubs only the generated artifact", () => {
  const workspace = mkdtempSync(join(tmpdir(), "freeholder-artifact-test-"));
  const artifact = join(workspace, ".next/standalone");
  try {
    mkdirSync(join(workspace, ".git"), { recursive: true });
    writeFileSync(join(workspace, ".git/HEAD"), "workspace must survive");
    for (const directory of [".git", ".agents", ".codex", ".claude", "apps", "test-results"]) {
      mkdirSync(join(artifact, directory), { recursive: true });
      writeFileSync(join(artifact, directory, "private.txt"), "not deployable");
    }
    writeFileSync(join(artifact, "server.js"), "// runtime");
    const gate = resolve("scripts/standalone-artifact-gate.mjs");
    const rejected = spawnSync(process.execPath, [gate], { cwd: workspace, encoding: "utf8" });
    expect(rejected.status).toBe(1);
    expect(rejected.stderr).toContain("source-only root present: .git/");
    expect(rejected.stderr).toContain("source-only root present: apps/");
    const scrubbed = spawnSync(process.execPath, [gate, "--scrub"], { cwd: workspace, encoding: "utf8" });
    expect(scrubbed.status).toBe(0);
    expect(scrubbed.stdout).toContain("1 files");
    expect(readFileSync(join(workspace, ".git/HEAD"), "utf8")).toBe("workspace must survive");
  } finally {
    if (!resolve(workspace).startsWith(resolve(tmpdir()) + sep)) throw new Error("Refusing to remove outside the test temporary directory.");
    rmSync(workspace, { recursive: true, force: true });
  }
});
