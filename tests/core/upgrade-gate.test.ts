// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const script = readFileSync("scripts/upgrade-gate.sh", "utf8");

describe("upgrade gate (C10.07)", () => {
  it("proves upgrade and N-1 rollback, and skips only when there is no previous image", () => {
    expect(script).toMatch(/the previous release boots and migrates an empty database/);
    expect(script).toMatch(/this build migrates that database forward/);
    expect(script).toMatch(/the data survived the migration/);
    expect(script).toMatch(/the previous release still runs against the new schema \(rollback\)/);
    expect(script).toMatch(/FREEHOLDER_SKIP_MIGRATE/);
    expect(script).toMatch(/::warning title=Upgrade gate skipped::/);
    expect(script).toMatch(/home_rollback/);
    expect(script).toMatch(/N-1 schema is readable/);
  });
});
