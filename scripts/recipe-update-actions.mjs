// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Prove one Tier-1 recipe's update and rollback actions (MASTER.md §39.8,
// C10.10).
//
// §39.8: "A recipe without a tested update path is not Tier 1, for the same
// reason one without a migration path is not: an approved platform must never
// be a place an instance goes to rot."
//
// What this gate can honestly prove without owning somebody else's control
// plane: the recipe declares an update and a rollback, the declared strategy
// is the one §39.8 assigns that target, the commands are the shape that
// strategy implies, and each command pins the artifact its rollback needs. It
// does not call doctl, render or railway — a green build must not depend on a
// third party's API being up, and a CI run that really redeployed would be
// deploying from a pull request.
import { readFileSync } from "node:fs";
import { parse } from "yaml";

const STRATEGY = {
  replit: "source-pull",
  "digitalocean-app": "deploy-hook",
  "digitalocean-droplet": "image-swap",
  railway: "deploy-hook",
  render: "deploy-hook",
  "docker-selfhost": "image-swap",
};

const SHAPE = {
  "image-swap": /\bdocker\s+compose\b[\s\S]*\bpull\b/,
  "deploy-hook": /\b(doctl\s+apps\s+update|render\s+deploys\s+create|railway\s+config)\b/,
  "source-pull": /\bpnpm\s+install\b[\s\S]*\bpnpm\s+build\b/,
};

/** What a rollback on this strategy must name to be a rollback at all. */
const ROLLBACK_PIN = {
  "image-swap": /\$PREVIOUS_FREEHOLDER_IMAGE\b/,
  "deploy-hook": /\$PREVIOUS_FREEHOLDER_(APP_SPEC|IMAGE_TAG)\b/,
  "source-pull": /\$PREVIOUS_FREEHOLDER_TAG\b/,
};

const target = process.argv[2];
if (!target || !STRATEGY[target]) {
  console.error(`recipe-update-actions: unknown target ${JSON.stringify(target)}`);
  process.exit(2);
}

const recipe = parse(readFileSync(`deploy/${target}/recipe.yaml`, "utf8"));
const expected = STRATEGY[target];
const problems = [];

const declared = recipe?.update?.strategy;
if (declared !== expected) {
  problems.push(`declares strategy ${JSON.stringify(declared)}; §39.8 assigns ${JSON.stringify(expected)}`);
}
if (!recipe?.update?.rollback) {
  problems.push("declares no update.rollback");
}

const update = recipe?.operations?.update;
const rollback = recipe?.operations?.rollback;
if (!update) {
  problems.push("has no operations.update");
} else if (!SHAPE[expected].test(update)) {
  problems.push(`operations.update is not a ${expected}: ${update}`);
}
if (!rollback) {
  problems.push("has no operations.rollback");
} else if (!ROLLBACK_PIN[expected].test(rollback)) {
  problems.push(
    `operations.rollback names no previous artifact, so it redeploys the same build: ${rollback}`,
  );
}

/**
 * An update command that does not reference a version cannot move anywhere.
 *
 * The tag is not always on the command line: App Platform builds a spec with
 * `prepare-do-app-spec.mjs`, which reads `FREEHOLDER_IMAGE_TAG` from the
 * environment. So follow any script the command invokes rather than demanding
 * the variable appear literally — otherwise this gate would force a worse
 * command in order to satisfy a weaker check.
 */
function pinsAnImageTag(command) {
  if (/\$FREEHOLDER_IMAGE_TAG/.test(command)) return true;
  if (/\bpull\b/.test(command)) return true;
  for (const match of command.matchAll(/\b(scripts\/[\w.-]+\.mjs)\b/g)) {
    let source = "";
    try {
      source = readFileSync(match[1], "utf8");
    } catch {
      problems.push(`operations.update invokes ${match[1]}, which does not exist`);
      continue;
    }
    if (source.includes("FREEHOLDER_IMAGE_TAG")) return true;
  }
  return false;
}

if (update && expected !== "source-pull" && !pinsAnImageTag(update)) {
  problems.push(
    `operations.update pins no image tag, directly or through a script it runs: ${update}`,
  );
}

if (problems.length > 0) {
  console.error(`${target}: update path is not Tier 1`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

console.log(`${target}: ${expected} update and rollback declared, shaped and pinned`);
