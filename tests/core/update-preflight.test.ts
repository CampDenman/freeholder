// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PLATFORM_VERSION } from "@/core/platform";
import { installPlugin } from "@/core/plugins/service";
import { pluginCompatibility, runPreflight } from "@/core/update/preflight";
import { preflightUpdate } from "@/core/update/service";
import {
  ANONYMOUS,
  closeDb,
  failure,
  hasDatabase,
  OWNER,
  truncateSpine,
} from "../helpers/spine";

describe("plugin compatibility (C10.05)", () => {
  it("names the plugin whose range misses the target", () => {
    const step = pluginCompatibility(
      [
        { name: "gift-registry", freeholder: "^0.1.0" },
        { name: "broken", freeholder: "^9.0.0" },
      ],
      "0.1.0",
    );
    expect(step.verdict).toBe("fail");
    expect(step.detail).toMatch(/broken needs \^9\.0\.0/);
    expect(pluginCompatibility([{ name: "gift-registry", freeholder: "^0.1.0" }], "0.1.0").verdict).toBe("ok");
  });
});

/** The next minor after this build: a release no current first-party range covers. */
function nextMinor(version: string): string {
  const [major, minor] = version.split(".").map((part) => Number.parseInt(part, 10));
  return `${major}.${(minor ?? 0) + 1}.0`;
}

function firstPartyPlugins(): { name: string; freeholder: string }[] {
  return readdirSync("plugins", { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => JSON.parse(readFileSync(join("plugins", entry.name, "plugin.json"), "utf8")) as {
      name: string;
      freeholder: string;
    });
}

describe("first-party plugin ranges in preflight (C10.05)", () => {
  it("fit this build and block the next minor, naming each plugin", () => {
    const plugins = firstPartyPlugins();
    expect(plugins.length).toBeGreaterThan(0);
    expect(pluginCompatibility(plugins, PLATFORM_VERSION).verdict).toBe("ok");
    const blocked = pluginCompatibility(plugins, nextMinor(PLATFORM_VERSION));
    expect(blocked.verdict).toBe("fail");
    for (const plugin of plugins) {
      expect(blocked.detail).toContain(`${plugin.name} needs ${plugin.freeholder}`);
    }
  });
});

describe.runIf(hasDatabase)("update preflight (C10.05)", { timeout: 60_000 }, () => {
  beforeEach(truncateSpine, 30_000);
  afterAll(closeDb);

  it("clones the live schema into a shadow schema and estimates downtime", async () => {
    const report = await runPreflight({});
    expect(report.steps.map((step) => step.id)).toEqual(
      expect.arrayContaining(["signature", "plugins", "drift", "postgres", "migrations", "downtime"]),
    );
    expect(report.steps.find((step) => step.id === "migrations")?.verdict).toBe("ok");
    expect(report.estimatedDowntimeMs).toBeGreaterThanOrEqual(0);
    expect(report.ok).toBe(false);
    expect(report.steps.find((step) => step.id === "signature")?.verdict).toBe("fail");
  });

  it("fails the migration step when the shadow SQL cannot run", async () => {
    const report = await runPreflight({ extraSql: ["SELECT 1/0"] });
    expect(report.ok).toBe(false);
    expect(report.steps.find((step) => step.id === "migrations")?.verdict).toBe("fail");
  });

  it("blocks an update that leaves an installed plugin outside its range", async () => {
    await installPlugin.call({ path: join("plugins", "gift-registry") }, OWNER);

    const current = await runPreflight({});
    expect(current.steps.find((step) => step.id === "plugins")?.verdict).toBe("ok");

    const target = nextMinor(PLATFORM_VERSION);
    const report = await runPreflight({ targetVersion: target });
    const plugins = report.steps.find((step) => step.id === "plugins");
    expect(plugins?.verdict).toBe("fail");
    expect(plugins?.detail).toContain(`Cannot apply ${target}: gift-registry needs ^`);
    expect(report.ok).toBe(false);
  });

  it("hard-stops on an unsigned feed and refuses anonymous callers", async () => {
    const report = await runPreflight({ feed: { schema: "freeholder/releases/v1" } });
    expect(report.steps.find((step) => step.id === "signature")?.verdict).toBe("fail");
    const denied = await failure(preflightUpdate.call({}, ANONYMOUS));
    expect(denied.code).toBe("permission");
    const owned = await preflightUpdate.call({}, OWNER);
    expect(owned.steps.length).toBeGreaterThan(0);
  });
});
