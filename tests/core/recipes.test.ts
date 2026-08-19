// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Every Tier-1 recipe has the mandated files and pair migrate notes (C3.16, C3.17).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REQUIRED_RECIPE_FILES, TIER1_RECIPES } from "@/core/recipes";
import { RECIPE_STEPS, tier1Pairs } from "@/core/portability/archive";

const ROOT = join(process.cwd(), "deploy");

describe("Tier-1 recipes (C3.16, C3.17)", () => {
  it.each(TIER1_RECIPES)("%s ships the mandated files", (target) => {
    for (const file of REQUIRED_RECIPE_FILES) {
      expect(existsSync(join(ROOT, target, file)), `${target}/${file}`).toBe(true);
    }
    const yaml = readFileSync(join(ROOT, target, "recipe.yaml"), "utf8");
    expect(yaml).toMatch(/tier:\s*1/);
    expect(yaml).toMatch(/update:/);
    expect(yaml).toMatch(/rollback/);
  });

  it("covers every Tier-1 pair in migrate.md", () => {
    const pairs = tier1Pairs();
    expect(pairs.length).toBe(TIER1_RECIPES.length * (TIER1_RECIPES.length - 1));
    for (const [from] of pairs) {
      const migrate = readFileSync(join(ROOT, from, "migrate.md"), "utf8").toLowerCase();
      expect(migrate).toMatch(/ownership export|export/);
      expect(migrate).toMatch(/dns/);
    }
  });

  it("names every required operational step", () => {
    expect(RECIPE_STEPS).toEqual([
      "install",
      "verify",
      "backup",
      "restore",
      "migrate-in",
      "migrate-out",
      "update",
      "rollback",
    ]);
  });
});
