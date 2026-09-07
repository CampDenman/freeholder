// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Prove (and optionally publish) a truthful package release (C3.20).
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const PACKAGE_FOLDERS = [
  "create-freeholder",
  "plugin-kit",
  "sdk",
  "templates",
];

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function releaseTag(version) {
  return `v${version}`;
}

export function parseReleaseTag(tag) {
  const match = /^v((0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?)$/.exec(
    tag.replace(/^refs\/tags\//, ""),
  );
  return match ? match[1] : null;
}

export function sdkVersionFromSource(source) {
  const match = /export const PLATFORM_VERSION = "([^"]+)";/.exec(source);
  return match ? match[1] : null;
}

export async function readAlignedVersion(root = repositoryRoot) {
  const platform = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  assert.match(platform.version, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/);
  for (const folder of PACKAGE_FOLDERS) {
    const manifest = JSON.parse(await readFile(join(root, "packages", folder, "package.json"), "utf8"));
    assert.equal(
      manifest.version,
      platform.version,
      `${manifest.name} must have the same version as the platform`,
    );
  }
  const sdkSource = await readFile(join(root, "packages", "sdk", "src", "version.ts"), "utf8");
  assert.equal(
    sdkVersionFromSource(sdkSource),
    platform.version,
    "packages/sdk/src/version.ts must match the platform version",
  );
  return platform.version;
}

export function assertTagMatchesVersion(ref, version) {
  const parsed = parseReleaseTag(ref);
  if (!parsed) {
    throw new Error(`Release tags must be vMAJOR.MINOR.PATCH (got ${ref}).`);
  }
  if (parsed !== version) {
    throw new Error(`Tag ${ref} does not match package.json version ${version}.`);
  }
}

function run(command, args, cwd, env = process.env) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      cwd,
      env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", rejectRun);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolveRun({ stdout, stderr });
        return;
      }
      rejectRun(
        new Error(
          [`${command} ${args.join(" ")} failed${signal ? ` (${signal})` : ` with exit ${code}`}.`, stdout.trim(), stderr.trim()]
            .filter(Boolean)
            .join("\n"),
        ),
      );
    });
  });
}

function npmInvocation() {
  const execPath = process.env.npm_execpath;
  if (execPath && /npm/i.test(execPath) && !/pnpm/i.test(execPath)) {
    return { command: process.execPath, prefix: [execPath] };
  }
  return { command: "corepack", prefix: ["npm"] };
}

export async function publishTarballs(archives, options = {}) {
  const npm = npmInvocation();
  const env = { ...process.env };
  if (options.token) env.NODE_AUTH_TOKEN = options.token;
  const tarballs = (await readdir(archives))
    .filter((entry) => entry.endsWith(".tgz"))
    .map((entry) => join(archives, entry))
    .sort();
  assert.ok(tarballs.length > 0, "expected packed tarballs");
  const args = options.publish ? [] : ["--dry-run"];
  for (const tarball of tarballs) {
    await run(npm.command, [...npm.prefix, "publish", tarball, "--access", "public", ...args], options.cwd ?? repositoryRoot, env);
  }
  return tarballs;
}

async function main() {
  const publish = process.argv.includes("--publish");
  const checkTag = publish || process.argv.includes("--check-tag");
  const version = await readAlignedVersion();
  const ref = process.env.GITHUB_REF ?? "";
  if (checkTag) {
    if (!ref.startsWith("refs/tags/")) {
      throw new Error("A vMAJOR.MINOR.PATCH git tag is required.");
    }
    assertTagMatchesVersion(ref, version);
  }
  if (publish) {
    const token = process.env.NODE_AUTH_TOKEN || process.env.NPM_TOKEN;
    if (!token) throw new Error("NODE_AUTH_TOKEN (or NPM_TOKEN) is required to publish.");
  }
  console.log(`Package release ${releaseTag(version)}: versions aligned.`);
}

const invoked = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
