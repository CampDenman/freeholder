// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.20/C10.02/C10.03: publication consumes the image's own declaration.
import { readFileSync, appendFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readAlignedVersion, assertTagMatchesVersion } from "./release-packages.mjs";
import { validateReleaseMetadata } from "../src/core/update/release-validation.mjs";
import { checklistItems } from "./plan-gate.mjs";

export function assertStableCompletion(master) {
  const items = checklistItems(master).filter((item) => /^C\d+\.\d+$/.test(item.id));
  const open = items.filter((item) => !item.checked);
  if (!items.some((item) => item.id === "C11.17") || open.length) {
    throw new Error(`Stable publication requires the completed MASTER.md checklist: ${open.map((item) => item.id).join(", ") || "C11.17 missing"}.`);
  }
  const signature = master.match(/\|\s*Owner signature\s*\|([^\n]*)/i)?.[1];
  if (!signature || /unsigned|_unsigned|pending/i.test(signature)) throw new Error("Stable publication requires the owner's completion signature.");
}

export function publicationPlan({ event, ref, sha, image, declaration, master }) {
  const release = validateReleaseMetadata(declaration);
  if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error("Publication requires the immutable source SHA.");
  if (!/^ghcr\.io\/[a-z0-9][a-z0-9_.-]*\/[a-z0-9][a-z0-9_.-]*$/.test(image)) throw new Error("Invalid image repository.");
  if (event === "workflow_run") return { release, tags: [`${image}:edge`, `${image}:sha-${sha.slice(0, 12)}`], prerelease: false, stable: false, npmTag: "next" };
  if (event !== "push") throw new Error("Only a successful main workflow or a version tag may publish.");
  assertTagMatchesVersion(ref, release.version);
  const prerelease = release.version.includes("-");
  if (!prerelease && release.channel === "edge") throw new Error("An edge declaration must use a prerelease version for tagged publication.");
  if (!prerelease) assertStableCompletion(master ?? "");
  if (release.schemaRisk === "breaking" && release.manualSteps.length === 0) throw new Error("A breaking tagged release must declare its recovery/manual steps.");
  const tags = [`${image}:${release.version}`, `${image}:sha-${sha.slice(0, 12)}`];
  if (!prerelease) {
    tags.push(`${image}:${release.version.split(".").slice(0, 2).join(".")}`, `${image}:stable`, `${image}:latest`);
  }
  return { release, tags, prerelease, stable: !prerelease, npmTag: prerelease ? "next" : "latest" };
}

async function main() {
  const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
  await readAlignedVersion(root);
  const plan = publicationPlan({
    event: process.env.GITHUB_EVENT_NAME,
    ref: process.env.GITHUB_REF,
    sha: process.env.RELEASE_SHA,
    image: process.env.IMAGE,
    declaration: JSON.parse(readFileSync(join(root, "src/core/update/release-declaration.json"), "utf8")),
    master: readFileSync(join(root, "MASTER.md"), "utf8"),
  });
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `prerelease=${plan.prerelease}\nstable=${plan.stable}\nnpm_tag=${plan.npmTag}\ntags<<FREEHOLDER_TAGS\n${plan.tags.join("\n")}\nFREEHOLDER_TAGS\n`);
  }
  console.log(JSON.stringify(plan, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
