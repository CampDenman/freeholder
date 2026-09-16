// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import cmsOnboarding from "@/modules/cms/onboarding";
import formsOnboarding from "@/modules/forms/onboarding";
import seedOnboarding from "@/modules/seed/onboarding";

describe("demo scenario migrations", () => {
  it("creates normalized definitions, runs and exact provenance with lifecycle invariants", () => {
    const sql = readFileSync("db/migrations/0000_reviewed-baseline.sql", "utf8");
    expect(sql).toContain('CREATE TABLE "demo_scenarios"');
    expect(sql).toContain('CREATE TABLE "demo_scenario_runs"');
    expect(sql).toContain('CREATE TABLE "demo_records"');
    expect(sql).toContain("demo_scenario_runs_one_active_idx");
    expect(sql).toContain("demo_scenario_runs_purge_consistent");
    expect(sql).toContain("demo_records_fixture_idx");
    expect(sql).toContain("demo_scenario_runs_definition_fk");
  });

  it("seeds the executable version-pinned built-in scenario exactly once", () => {
    const migration = readFileSync(
      "db/migrations/0000_reviewed-baseline.sql",
      "utf8",
    );
    const seeded = migration.slice(migration.indexOf('INSERT INTO "demo_scenarios"'));
    const fixtureJson = seeded.match(/\$\$(\[[\s\S]*?\])\$\$::jsonb/)?.[1];
    expect(fixtureJson).toBeDefined();
    expect(JSON.parse(fixtureJson!)).toEqual([
      cmsOnboarding.fixtures[0],
      formsOnboarding.fixtures[0],
    ]);
    const scenario = seedOnboarding.scenarios[0]!;
    expect(migration).toContain(`'${scenario.key}', ${scenario.version}`);
    expect(migration).toContain(`'${scenario.titleKey}'`);
    expect(migration).toContain(`'${scenario.descriptionKey}'`);
    expect(migration).toContain('ON CONFLICT ("key", "version") DO NOTHING');
  });
});
