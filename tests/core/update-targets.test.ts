// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { TIER1_TARGETS } from "@/core/portability/archive";
import {
  assertStrategyMatchesOperations,
  describeTargets,
  recipeUpdateTarget,
  STRATEGIES,
  TARGET_STRATEGY,
  TARGET_OPERATIONS,
  TargetActionError,
  UPDATE_STRATEGIES,
  configuredTarget,
  resolveUpdateTarget,
  type CommandRunner,
} from "@/core/update/targets";

interface Recipe {
  operations?: { update?: string; rollback?: string };
  update?: { strategy?: string; rollback?: string };
}

function recipe(target: string): Recipe {
  return parse(readFileSync(join("deploy", target, "recipe.yaml"), "utf8")) as Recipe;
}

describe("per-target update actions (C10.10)", () => {
  describe("every Tier-1 recipe declares what it actually does", () => {
    // §39.8: "A recipe without a tested update path is not Tier 1." Before
    // this gate all six declared image-swap, including Replit — which has no
    // image and rebuilds from source — and App Platform, which hands the
    // image to doctl. The declaration was a comment nobody checked.
    for (const target of TIER1_TARGETS) {
      it(`${target} declares ${TARGET_STRATEGY[target]} and implements it`, () => {
        const parsed = recipe(target);
        const problems = assertStrategyMatchesOperations({
          target,
          update: parsed.update,
          operations: parsed.operations,
        });
        expect(problems.map((problem) => problem.problem)).toEqual([]);
      });
    }

    it("covers every Tier-1 target, so a new recipe cannot skip the question", () => {
      expect(Object.keys(TARGET_STRATEGY).sort()).toEqual([...TIER1_TARGETS].sort());
    });

    it("names three genuinely different meanings of update", () => {
      expect(new Set(Object.values(TARGET_STRATEGY))).toEqual(new Set(UPDATE_STRATEGIES));
    });
  });

  describe("the embedded copy cannot drift from the recipe", () => {
    // A standalone build does not ship `deploy/`, so the commands are embedded
    // in source. That copy is only safe while this test exists.
    for (const target of TIER1_TARGETS) {
      it(`${target}: embedded commands equal recipe.yaml`, () => {
        const parsed = recipe(target);
        expect(TARGET_OPERATIONS[target].update).toBe(parsed.operations?.update);
        expect(TARGET_OPERATIONS[target].rollback).toBe(parsed.operations?.rollback);
      });
    }
  });

  describe("what this instance resolves to", () => {
    it("swaps nothing when no recipe is declared, rather than guessing", async () => {
      const calls: string[] = [];
      const target = resolveUpdateTarget({
        target: null,
        run: async (command) => {
          calls.push(command);
          return { code: 0, stderr: "" };
        },
      });
      await target.cutover();
      await target.rollbackCutover();
      expect(calls).toEqual([]);
    });

    it("runs the declared recipe's commands when one is declared", async () => {
      const calls: string[] = [];
      const target = resolveUpdateTarget({
        target: "digitalocean-droplet",
        imageTag: "0.2.0",
        run: async (command) => {
          calls.push(command);
          return { code: 0, stderr: "" };
        },
      });
      await target.cutover();
      expect(calls[0]).toContain("docker compose");
      expect(calls[0]).toContain("pull");
    });

    it("refuses a recipe name it does not recognise", () => {
      expect(configuredTarget("heroku")).toBeNull();
      expect(configuredTarget(undefined)).toBeNull();
      expect(configuredTarget("render")).toBe("render");
    });
  });

  describe("the gate refuses drift rather than reporting it", () => {
    it("catches a recipe that declares one strategy and runs another", () => {
      const problems = assertStrategyMatchesOperations({
        target: "replit",
        update: { strategy: "image-swap", rollback: "pin the previous tag" },
        operations: { update: "corepack enable && pnpm install && pnpm build", rollback: "x" },
      });
      expect(problems.map((p) => p.problem)).toEqual([
        'declares "image-swap" but §39.8 assigns it "source-pull"',
        'declares "image-swap" but operations.update does not do that: corepack enable && pnpm install && pnpm build',
      ]);
    });

    it("catches a missing rollback, because an untestable rollback is not one", () => {
      const problems = assertStrategyMatchesOperations({
        target: "docker-selfhost",
        update: { strategy: "image-swap" },
        operations: { update: "docker compose -f x.yml pull && docker compose -f x.yml up -d" },
      });
      expect(problems.map((p) => p.problem)).toEqual([
        "declares no rollback",
        "has no operations.rollback command",
      ]);
    });

    it("refuses an unknown strategy outright", () => {
      const problems = assertStrategyMatchesOperations({
        target: "render",
        update: { strategy: "vibes", rollback: "y" },
        operations: { update: "x", rollback: "y" },
      });
      expect(problems).toEqual([
        { target: "render", problem: 'declares unknown update strategy "vibes"' },
      ]);
    });
  });

  describe("running a target's own update and rollback", () => {
    function recorder(code = 0): { run: CommandRunner; calls: { command: string; env: Record<string, string> }[] } {
      const calls: { command: string; env: Record<string, string> }[] = [];
      const run: CommandRunner = async (command, env) => {
        calls.push({ command, env });
        return { code, stderr: code === 0 ? "" : "boom" };
      };
      return { run, calls };
    }

    it("runs the recipe's real update command with the image tag it was given", async () => {
      const { run, calls } = recorder();
      const parsed = recipe("render");
      const target = recipeUpdateTarget({
        target: "render",
        operations: parsed.operations!,
        run,
        imageTag: "0.2.0",
      });
      await target.pull("sha256:whatever");
      await target.cutover();
      expect(calls).toHaveLength(1);
      expect(calls[0]!.command).toContain("render deploys create");
      expect(calls[0]!.env.FREEHOLDER_IMAGE_TAG).toBe("0.2.0");
    });

    it("rolls back with the artifact that strategy actually needs", async () => {
      const { run, calls } = recorder();
      const parsed = recipe("replit");
      const target = recipeUpdateTarget({
        target: "replit",
        operations: parsed.operations!,
        run,
        previousTag: "v0.1.0",
      });
      await target.rollbackCutover();
      expect(calls[0]!.command).toContain("git switch --detach $PREVIOUS_FREEHOLDER_TAG");
      expect(calls[0]!.env.PREVIOUS_FREEHOLDER_TAG).toBe("v0.1.0");
    });

    it("raises a named error the apply flow can roll back on", async () => {
      const { run } = recorder(1);
      const target = recipeUpdateTarget({
        target: "docker-selfhost",
        operations: { update: "docker compose pull", rollback: "docker compose up -d" },
        run,
      });
      await expect(target.cutover()).rejects.toBeInstanceOf(TargetActionError);
      await expect(target.cutover()).rejects.toThrow("docker-selfhost: update failed. boom");
    });

    it("refuses to pretend a target without a rollback command can roll back", async () => {
      const { run } = recorder();
      const target = recipeUpdateTarget({
        target: "railway",
        operations: { update: "railway config apply" },
        run,
      });
      await expect(target.rollbackCutover()).rejects.toThrow("cannot be rolled back automatically");
    });
  });

  describe("what an owner is told before leaving updates on", () => {
    it("states the cutover cost and rollback artifact per target", () => {
      const described = describeTargets();
      expect(described).toHaveLength(TIER1_TARGETS.length);
      const replit = described.find((entry) => entry.target === "replit")!;
      expect(replit.strategy).toBe("source-pull");
      expect(replit.cutoverCost).toBe("minutes");
      expect(replit.rollbackArtifact).toBe("the previous commit");
      const droplet = described.find((entry) => entry.target === "digitalocean-droplet")!;
      expect(droplet.cutoverCost).toBe("seconds");
    });

    it("gives every strategy a definition, so none is a bare string", () => {
      for (const strategy of UPDATE_STRATEGIES) {
        expect(STRATEGIES[strategy].means.length).toBeGreaterThan(20);
        expect(STRATEGIES[strategy].rollbackArtifact).toBeTruthy();
      }
    });
  });
});
