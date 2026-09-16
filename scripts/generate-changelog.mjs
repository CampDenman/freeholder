// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C11.15: turn the changeset inbox into a CHANGELOG.md whose top version
// matches package.json. Changesets stay unconsumed — this is the output gate
// the changelog-gate input never had.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = process.cwd();
const CHANGESET_DIR = join(ROOT, ".changeset");
const SKIP = new Set(["README.md", "config.json"]);

function packageVersion() {
  return JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;
}

function parseChangeset(filename, source) {
  const match = source.replace(/^\uFEFF/, "").match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) {
    throw new Error(`Changeset ${filename} is missing YAML front matter.`);
  }
  const bumps = [];
  for (const line of match[1].split(/\r?\n/)) {
    const bump = line.match(/^["']?([^"']+)["']?:\s*(major|minor|patch)\s*$/);
    if (bump) bumps.push({ package: bump[1], kind: bump[2] });
  }
  if (bumps.length === 0) {
    throw new Error(`Changeset ${filename} declares no package bumps.`);
  }
  const body = match[2].trim().replace(/\s+/g, " ");
  if (!body) {
    throw new Error(`Changeset ${filename} has no release note.`);
  }
  return { filename, bumps, body };
}

function kindFor(entry) {
  if (entry.bumps.some((bump) => bump.kind === "major")) return "major";
  if (entry.bumps.some((bump) => bump.kind === "minor")) return "minor";
  return "patch";
}

export function collectChangesets() {
  return readdirSync(CHANGESET_DIR)
    .filter((name) => name.endsWith(".md") && !SKIP.has(name))
    .sort()
    .map((name) => parseChangeset(name, readFileSync(join(CHANGESET_DIR, name), "utf8")));
}

export function renderChangelog(version, entries) {
  const groups = { major: [], minor: [], patch: [] };
  for (const entry of entries) groups[kindFor(entry)].push(entry);
  const sections = [];
  for (const [kind, heading] of [
    ["major", "Major Changes"],
    ["minor", "Minor Changes"],
    ["patch", "Patch Changes"],
  ]) {
    const items = groups[kind];
    if (!items.length) continue;
    sections.push(
      `### ${heading}\n\n${items.map((entry) => `- ${entry.body}`).join("\n")}`,
    );
  }
  return `# Changelog

All notable changes to Freeholder are recorded as changesets and summarized
here. The heading version is the same string \`package.json\`, health, OpenAPI
and the SDK publish.

## ${version}

Active development, not a release candidate.

${sections.join("\n\n")}
`;
}

export function changelogTopVersion(source) {
  return source.match(/^## (\d+\.\d+\.\d+)/m)?.[1] ?? null;
}

function main() {
  const version = packageVersion();
  const entries = collectChangesets();
  writeFileSync(join(ROOT, "CHANGELOG.md"), renderChangelog(version, entries));
  console.log(`Wrote CHANGELOG.md for ${version} (${entries.length} changesets).`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main();
}
