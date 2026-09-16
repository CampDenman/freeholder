// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { afterAll, beforeEach, describe, expect, it } from "vitest";
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
    expect(report.ok).toBe(true);
  });

  it("fails the migration step when the shadow SQL cannot run", async () => {
    const report = await runPreflight({ extraSql: ["SELECT 1/0"] });
    expect(report.ok).toBe(false);
    expect(report.steps.find((step) => step.id === "migrations")?.verdict).toBe("fail");
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
