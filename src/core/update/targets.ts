// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Per-target update and rollback (MASTER.md §39.8, C10.10).
//
// §39.8: "Updating is a step in the recipe (§18), not one script." Three
// platforms, three genuinely different meanings of the word update:
//
//   - **image-swap** — pull a new digest and restart the container. The
//     droplet and self-host recipes. Rollback is pulling the previous digest,
//     which is why §39.11's rollback horizon is about schema contraction and
//     not about whether the old bytes still exist.
//   - **deploy-hook** — hand the new image to the platform's own deploy API
//     and let it do the swap. App Platform, Render, Railway. Rollback is
//     redeploying the previous spec, so the *previous spec* is the artifact
//     that has to survive, not a local image.
//   - **source-pull** — fetch source, install, rebuild, restart. Replit.
//     There is no image, so a rollback is a pin to the previous commit and it
//     is the slowest of the three, which an owner should be told before they
//     leave automatic updates on.
//
// A recipe that declares one strategy and implements another is the failure
// this module exists to make impossible: `assertStrategyMatchesOperations`
// runs in CI, so the declaration cannot drift away from the commands.
import { spawn } from "node:child_process";
import { env } from "@/core/env";
import { TIER1_TARGETS, type Tier1Target } from "@/core/portability/archive";
import { localUpdateTarget, type UpdateTarget } from "./apply";

export const UPDATE_STRATEGIES = ["image-swap", "deploy-hook", "source-pull"] as const;
export type UpdateStrategy = (typeof UPDATE_STRATEGIES)[number];

export interface StrategyDefinition {
  id: UpdateStrategy;
  /** What "update" does on this kind of target. */
  means: string;
  /** What has to survive for a rollback to be possible at all. */
  rollbackArtifact: string;
  /** Roughly how long an owner is down or degraded. Honesty, not a promise. */
  cutoverCost: "seconds" | "a minute or two" | "minutes";
}

export const STRATEGIES: Record<UpdateStrategy, StrategyDefinition> = {
  "image-swap": {
    id: "image-swap",
    means: "Pull the new image digest and restart the container in place.",
    rollbackArtifact: "the previous image digest",
    cutoverCost: "seconds",
  },
  "deploy-hook": {
    id: "deploy-hook",
    means: "Hand the new image to the platform's deploy API and let it perform the swap.",
    rollbackArtifact: "the previous deploy spec",
    cutoverCost: "a minute or two",
  },
  "source-pull": {
    id: "source-pull",
    means: "Fetch source, install dependencies, rebuild and restart.",
    rollbackArtifact: "the previous commit",
    cutoverCost: "minutes",
  },
};

/**
 * What each Tier-1 recipe actually does, per §39.8.
 *
 * This is the normative list. `recipe.yaml` restates it for the owner reading
 * the recipe, and the gate below proves the two agree.
 */
export const TARGET_STRATEGY: Record<Tier1Target, UpdateStrategy> = {
  replit: "source-pull",
  "digitalocean-app": "deploy-hook",
  "digitalocean-droplet": "image-swap",
  railway: "deploy-hook",
  render: "deploy-hook",
  "docker-selfhost": "image-swap",
};

/**
 * The commands each Tier-1 recipe runs, embedded rather than read from disk.
 *
 * `recipe.yaml` remains the source of truth an owner reads, and
 * `tests/core/update-targets.test.ts` fails if this copy drifts from it. The
 * copy exists because a standalone build does not ship `deploy/`, and an
 * updater that cannot find its own instructions at the moment it is asked to
 * update is worse than one that never offered.
 */
export const TARGET_OPERATIONS: Record<Tier1Target, Required<RecipeOperations>> = {
  replit: {
    update: "corepack enable && pnpm install --frozen-lockfile && pnpm build",
    rollback:
      "git switch --detach $PREVIOUS_FREEHOLDER_TAG && pnpm install --frozen-lockfile && pnpm build",
  },
  "digitalocean-app": {
    update:
      "node scripts/prepare-do-app-spec.mjs --output .freeholder-do-app-update.yaml && doctl apps update $DIGITALOCEAN_APP_ID --spec .freeholder-do-app-update.yaml",
    rollback: "doctl apps update $DIGITALOCEAN_APP_ID --spec $PREVIOUS_FREEHOLDER_APP_SPEC",
  },
  "digitalocean-droplet": {
    update:
      "docker compose -f deploy/digitalocean-droplet/infra/compose.yml pull && docker compose -f deploy/digitalocean-droplet/infra/compose.yml up -d",
    rollback:
      "FREEHOLDER_IMAGE=$PREVIOUS_FREEHOLDER_IMAGE docker compose -f deploy/digitalocean-droplet/infra/compose.yml up -d",
  },
  railway: {
    update:
      "FREEHOLDER_IMAGE=ghcr.io/campdenman/freeholder:$FREEHOLDER_IMAGE_TAG railway config plan && FREEHOLDER_IMAGE=ghcr.io/campdenman/freeholder:$FREEHOLDER_IMAGE_TAG railway config apply",
    rollback:
      "FREEHOLDER_IMAGE=ghcr.io/campdenman/freeholder:$PREVIOUS_FREEHOLDER_IMAGE_TAG railway config plan && FREEHOLDER_IMAGE=ghcr.io/campdenman/freeholder:$PREVIOUS_FREEHOLDER_IMAGE_TAG railway config apply",
  },
  render: {
    update:
      "render deploys create $RENDER_SERVICE_ID --image ghcr.io/campdenman/freeholder:$FREEHOLDER_IMAGE_TAG --wait",
    rollback:
      "render deploys create $RENDER_SERVICE_ID --image ghcr.io/campdenman/freeholder:$PREVIOUS_FREEHOLDER_IMAGE_TAG --wait",
  },
  "docker-selfhost": {
    update:
      "docker compose -f deploy/docker-selfhost/infra/compose.yml pull && docker compose -f deploy/docker-selfhost/infra/compose.yml up -d",
    rollback:
      "FREEHOLDER_IMAGE=$PREVIOUS_FREEHOLDER_IMAGE docker compose -f deploy/docker-selfhost/infra/compose.yml up -d",
  },
};

/** Shapes that identify a strategy from the command a recipe actually runs. */
const OPERATION_SHAPE: Record<UpdateStrategy, RegExp> = {
  "image-swap": /\bdocker\s+compose\b[\s\S]*\bpull\b/,
  "deploy-hook": /\b(doctl\s+apps\s+update|render\s+deploys\s+create|railway\s+config)\b/,
  "source-pull": /\bpnpm\s+install\b[\s\S]*\bpnpm\s+build\b/,
};

export interface RecipeUpdateBlock {
  strategy?: string;
  rollback?: string;
}

export interface RecipeOperations {
  update?: string;
  rollback?: string;
}

export interface StrategyMismatch {
  target: string;
  problem: string;
}

/**
 * Refuse a recipe whose declared strategy is not what its commands do.
 *
 * §39.8: "A recipe without a tested update path is not Tier 1, for the same
 * reason one without a migration path is not." A declaration nobody checks is
 * not a tested update path — it is a comment.
 */
export function assertStrategyMatchesOperations(input: {
  target: string;
  update: RecipeUpdateBlock | undefined;
  operations: RecipeOperations | undefined;
}): StrategyMismatch[] {
  const problems: StrategyMismatch[] = [];
  const declared = input.update?.strategy;
  const expected = TARGET_STRATEGY[input.target as Tier1Target];

  if (!declared) {
    problems.push({ target: input.target, problem: "declares no update strategy" });
    return problems;
  }
  if (!UPDATE_STRATEGIES.includes(declared as UpdateStrategy)) {
    problems.push({
      target: input.target,
      problem: `declares unknown update strategy "${declared}"`,
    });
    return problems;
  }
  if (expected && declared !== expected) {
    problems.push({
      target: input.target,
      problem: `declares "${declared}" but §39.8 assigns it "${expected}"`,
    });
  }
  if (!input.update?.rollback) {
    problems.push({ target: input.target, problem: "declares no rollback" });
  }

  const command = input.operations?.update;
  if (!command) {
    problems.push({ target: input.target, problem: "has no operations.update command" });
  } else if (!OPERATION_SHAPE[declared as UpdateStrategy].test(command)) {
    problems.push({
      target: input.target,
      problem: `declares "${declared}" but operations.update does not do that: ${command}`,
    });
  }
  if (!input.operations?.rollback) {
    problems.push({ target: input.target, problem: "has no operations.rollback command" });
  }
  return problems;
}

export type CommandRunner = (
  command: string,
  env: Record<string, string>,
) => Promise<{ code: number; stderr: string }>;

export class TargetActionError extends Error {
  constructor(
    readonly target: string,
    readonly action: "update" | "rollback",
    detail: string,
  ) {
    super(`${target}: ${action} failed. ${detail}`);
    this.name = "TargetActionError";
  }
}

/**
 * An `UpdateTarget` that runs what the recipe declares.
 *
 * `pull` is deliberately a no-op for every strategy: all three recipes fetch
 * and cut over in one command, and splitting a single command into two phases
 * would mean claiming a pull succeeded when nothing has run. The apply flow
 * (C10.06) already treats a failed cutover as a rollback trigger, which is
 * the behaviour this needs.
 */
export function recipeUpdateTarget(input: {
  target: Tier1Target;
  operations: RecipeOperations;
  run: CommandRunner;
  /** Set on rollback so a recipe can pin what it is going back to. */
  previousImage?: string;
  previousSpec?: string;
  previousTag?: string;
  imageTag?: string;
}): UpdateTarget {
  const environment = () => ({
    ...(input.imageTag ? { FREEHOLDER_IMAGE_TAG: input.imageTag } : {}),
    ...(input.previousImage ? { PREVIOUS_FREEHOLDER_IMAGE: input.previousImage } : {}),
    ...(input.previousSpec ? { PREVIOUS_FREEHOLDER_APP_SPEC: input.previousSpec } : {}),
    ...(input.previousTag ? { PREVIOUS_FREEHOLDER_TAG: input.previousTag } : {}),
  });

  return {
    async pull() {},
    async cutover() {
      const command = input.operations.update;
      if (!command) {
        throw new TargetActionError(input.target, "update", "The recipe declares no update command.");
      }
      const result = await input.run(command, environment());
      if (result.code !== 0) {
        throw new TargetActionError(input.target, "update", result.stderr.trim() || `exited ${result.code}`);
      }
    },
    async rollbackCutover() {
      const command = input.operations.rollback;
      if (!command) {
        throw new TargetActionError(
          input.target,
          "rollback",
          "The recipe declares no rollback command, so this target cannot be rolled back automatically.",
        );
      }
      const result = await input.run(command, environment());
      if (result.code !== 0) {
        throw new TargetActionError(input.target, "rollback", result.stderr.trim() || `exited ${result.code}`);
      }
    },
  };
}

/** Every Tier-1 target and what updating means there, for Doctor and the CLI. */
export function describeTargets(): {
  target: Tier1Target;
  strategy: UpdateStrategy;
  means: string;
  rollbackArtifact: string;
  cutoverCost: StrategyDefinition["cutoverCost"];
}[] {
  return TIER1_TARGETS.map((target) => {
    const strategy = TARGET_STRATEGY[target];
    const definition = STRATEGIES[strategy];
    return {
      target,
      strategy,
      means: definition.means,
      rollbackArtifact: definition.rollbackArtifact,
      cutoverCost: definition.cutoverCost,
    };
  });
}

/**
 * Run one recipe command through the platform's own shell.
 *
 * These commands are `&&`-chained pipelines written by this repository and
 * reviewed in `recipe.yaml`, not owner input, which is why a shell is the
 * right thing here and is not the injection risk the fork lane's refs are.
 * The environment is the process's own plus the pinning variables the
 * strategy needs — never a caller-supplied map.
 */
export const shellRunner: CommandRunner = (command, extra) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, {
      shell: true,
      stdio: ["ignore", "inherit", "pipe"],
      env: { ...process.env, ...extra },
    });
    let stderr = "";
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("exit", (code) => resolve({ code: code ?? 1, stderr }));
  });

export function configuredTarget(
  value: string | undefined = env().FREEHOLDER_RECIPE_TARGET,
): Tier1Target | null {
  if (!value) return null;
  return (TIER1_TARGETS as readonly string[]).includes(value) ? (value as Tier1Target) : null;
}

/**
 * The target this instance actually runs on, or the in-process one.
 *
 * An instance that has not declared its recipe gets `localUpdateTarget`, which
 * migrates and smokes but does not swap anything. That is the honest answer:
 * guessing a deploy strategy from the environment and then running a container
 * command against it is how an update takes down a host nobody meant to touch.
 */
export function resolveUpdateTarget(input?: {
  target?: Tier1Target | null;
  run?: CommandRunner;
  previousImage?: string;
  previousSpec?: string;
  previousTag?: string;
  imageTag?: string;
}): UpdateTarget {
  const target = input?.target ?? configuredTarget();
  if (!target) return localUpdateTarget;
  return recipeUpdateTarget({
    target,
    operations: TARGET_OPERATIONS[target],
    run: input?.run ?? shellRunner,
    previousImage: input?.previousImage,
    previousSpec: input?.previousSpec,
    previousTag: input?.previousTag,
    imageTag: input?.imageTag,
  });
}
