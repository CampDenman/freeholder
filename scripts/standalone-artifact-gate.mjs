// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The deployable server must contain runtime code, not the repository or the
// environment from the machine that built it.
import { lstat, readdir, rm } from "node:fs/promises";
import path from "node:path";

// Next 16/Turbopack splits this route-rich application into thousands of small
// server chunks. File count is still bounded to catch a traced repository or
// dependency explosion, but it needs headroom above the clean-build baseline
// (9,351 at C7.15). Bytes and forbidden roots remain the stronger boundaries.
const MAX_FILES = 12_000;
const MAX_BYTES = 200 * 1024 * 1024;
const STANDALONE = path.resolve(".next", "standalone");
const FORBIDDEN_ROOTS = new Set([
  "app",
  "db",
  "deploy",
  "locales",
  "packages",
  "plugins",
  "scripts",
  "seed",
  "src",
  "tests",
]);
const FORBIDDEN_ROOT_FILES = new Set([
  "CLAUDE.md",
  "HANDOFF.md",
  "MASTER.md",
  "README.md",
  "RESTART_HANDOFF.md",
]);

function isEnvironmentFile(name) {
  return name === ".env" || name.startsWith(".env.");
}

async function scrubBuildOnlyFiles() {
  const entries = await readdir(STANDALONE, { withFileTypes: true });
  const removed = [];
  for (const entry of entries) {
    const removeDirectory = entry.isDirectory() && FORBIDDEN_ROOTS.has(entry.name);
    const removeFile = entry.isFile() && (
      isEnvironmentFile(entry.name) || FORBIDDEN_ROOT_FILES.has(entry.name)
    );
    if (!removeDirectory && !removeFile) continue;
    const target = path.join(STANDALONE, entry.name);
    await rm(target, { recursive: removeDirectory, force: true });
    removed.push(removeDirectory ? `${entry.name}/` : entry.name);
  }
  return removed;
}

async function inventory(directory, relative = "") {
  const files = [];
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const childRelative = relative
      ? `${relative}/${entry.name}`
      : entry.name;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await inventory(absolute, childRelative)));
      continue;
    }
    const details = await lstat(absolute);
    files.push({ path: childRelative, bytes: details.size });
  }
  return files;
}

async function main() {
  const server = path.join(STANDALONE, "server.js");
  const serverDetails = await lstat(server).catch(() => null);
  if (!serverDetails?.isFile()) {
    throw new Error(`Standalone server is missing: ${server}`);
  }

  const removed = process.argv.includes("--scrub")
    ? await scrubBuildOnlyFiles()
    : [];
  const files = await inventory(STANDALONE);
  const bytes = files.reduce((sum, file) => sum + file.bytes, 0);
  const paths = new Set(files.map((file) => file.path));
  const rootEntries = new Set(
    files.map((file) => file.path.split("/", 1)[0]),
  );
  const problems = [];

  for (const root of FORBIDDEN_ROOTS) {
    if (rootEntries.has(root)) problems.push(`source-only root present: ${root}/`);
  }
  for (const file of FORBIDDEN_ROOT_FILES) {
    if (paths.has(file)) problems.push(`source-only root file present: ${file}`);
  }
  for (const file of files) {
    if (isEnvironmentFile(path.posix.basename(file.path))) {
      problems.push(`environment file present: ${file.path}`);
    }
  }
  if (files.length > MAX_FILES) {
    problems.push(`file count ${files.length} exceeds ${MAX_FILES}`);
  }
  if (bytes > MAX_BYTES) {
    problems.push(`size ${bytes} bytes exceeds ${MAX_BYTES}`);
  }

  if (problems.length > 0) {
    throw new Error(
      `Standalone artifact boundary failed:\n${problems
        .map((problem) => `  - ${problem}`)
        .join("\n")}`,
    );
  }

  const scrubbed = removed.length > 0
    ? `; scrubbed ${removed.join(", ")}`
    : "";
  console.log(
    `Standalone artifact: ${files.length} files, ${bytes} bytes, no source or environment leakage${scrubbed}.`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
