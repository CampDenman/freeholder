// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { inspectPluginFolder, scaffoldPlugin } from "@freeholder/plugin-kit";

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("plugin scaffold and harness (C3.12)", () => {
  it("emits block, service, adapter, automation and route examples", async () => {
    const root = await mkdtemp(join(tmpdir(), "plugin-scaffold-"));
    dirs.push(root);
    await scaffoldPlugin(root, "example-widget");
    const report = await inspectPluginFolder(root);
    expect(report.name).toBe("example-widget");
    expect(report.changelog).toBe(true);
    expect(report.examples).toEqual(
      expect.arrayContaining(["block", "service", "adapter", "automation", "route"]),
    );
  });
});
