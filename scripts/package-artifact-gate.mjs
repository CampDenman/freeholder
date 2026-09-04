// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Prove the separately published packages work outside the workspace.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageNames = [
  "create-freeholder",
  "@freeholder/plugin-kit",
  "@freeholder/sdk",
  "@freeholder/templates",
];

async function run(command, args, cwd) {
  await new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, NO_COLOR: "1" },
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
        resolveRun();
        return;
      }
      rejectRun(
        new Error(
          [
            `${command} ${args.join(" ")} failed${signal ? ` (${signal})` : ` with exit ${code}`}.`,
            stdout.trim(),
            stderr.trim(),
          ]
            .filter(Boolean)
            .join("\n"),
        ),
      );
    });
  });
}

async function runPnpm(args, cwd) {
  const pnpmEntry = process.env.npm_execpath;
  assert.ok(
    pnpmEntry && /pnpm/i.test(pnpmEntry),
    "run the artifact gate through `pnpm packages:verify` so the exact pinned pnpm CLI is available",
  );
  await run(process.execPath, [pnpmEntry, ...args], cwd);
}

async function assertPackageVersions() {
  const rootManifest = JSON.parse(await readFile(join(repositoryRoot, "package.json"), "utf8"));
  for (const name of packageNames) {
    const folder = name === "create-freeholder" ? name : name.split("/")[1];
    const manifest = JSON.parse(
      await readFile(join(repositoryRoot, "packages", folder, "package.json"), "utf8"),
    );
    assert.equal(
      manifest.version,
      rootManifest.version,
      `${name} must have the same version as the platform`,
    );
  }
}

async function main() {
  const scratch = await mkdtemp(join(tmpdir(), "freeholder-package-gate-"));
  const archives = join(scratch, "archives");
  const consumer = join(scratch, "consumer");
  try {
    await mkdir(archives, { recursive: true });
    await mkdir(consumer, { recursive: true });
    await assertPackageVersions();
    await runPnpm(["packages:build"], repositoryRoot);
    for (const name of packageNames) {
      await runPnpm(
        ["--filter", name, "pack", "--pack-destination", archives],
        repositoryRoot,
      );
    }

    const tarballs = (await readdir(archives))
      .filter((entry) => entry.endsWith(".tgz"))
      .map((entry) => join(archives, entry));
    assert.equal(tarballs.length, packageNames.length, "every package must produce one tarball");
    await writeFile(
      join(consumer, "package.json"),
      `${JSON.stringify({ name: "freeholder-package-smoke", private: true, type: "module" }, null, 2)}\n`,
    );
    await runPnpm(
      ["add", "--ignore-scripts", "--offline", ...tarballs],
      consumer,
    );

    await writeFile(
      join(consumer, "smoke.mjs"),
      `import assert from "node:assert/strict";
import { createClient, PLATFORM_VERSION } from "@freeholder/sdk";
import { definePlugin } from "@freeholder/plugin-kit";
import { listPresets } from "@freeholder/templates";
assert.equal(typeof createClient, "function");
assert.equal(typeof definePlugin, "function");
assert.match(PLATFORM_VERSION, /^\\d+\\.\\d+\\.\\d+/);
assert.deepEqual(listPresets().sort(), ["creator", "service-business", "shop"].sort());
`,
    );
    await run(process.execPath, [join(consumer, "smoke.mjs")], consumer);
    await writeFile(
      join(consumer, "consumer.mts"),
      `import { createClient, PLATFORM_VERSION } from "@freeholder/sdk";
import { definePlugin } from "@freeholder/plugin-kit";
import { preset } from "@freeholder/templates";
void createClient;
void PLATFORM_VERSION;
void definePlugin;
void preset;
`,
    );
    await run(
      process.execPath,
      [
        join(repositoryRoot, "node_modules", "typescript", "bin", "tsc"),
        "--noEmit",
        "--strict",
        "--target", "ES2022",
        "--module", "Node16",
        "--moduleResolution", "Node16",
        "--lib", "ES2022,DOM",
        join(consumer, "consumer.mts"),
      ],
      consumer,
    );

    const bin = join(
      consumer,
      "node_modules",
      ".bin",
      process.platform === "win32" ? "create-freeholder.cmd" : "create-freeholder",
    );
    await access(bin);
    await run(
      process.execPath,
      [
        join(consumer, "node_modules", "create-freeholder", "dist", "index.js"),
        "studio",
        "--non-interactive",
        "--target=railway",
        "--preset=shop",
        "--country=CA",
        "--payments=later",
      ],
      consumer,
    );
    const generatedRoot = join(consumer, "studio");
    const generatedManifest = JSON.parse(
      await readFile(join(generatedRoot, "package.json"), "utf8"),
    );
    assert.equal(generatedManifest.name, "studio");
    assert.doesNotMatch(JSON.stringify(generatedManifest.scripts), /\becho\b/i);
    for (const required of [
      "app",
      "db",
      "deploy/railway",
      "scripts",
      "src",
      ".env.example",
      "freeholder.config.ts",
    ]) {
      await readFile(join(generatedRoot, required), "utf8").catch(async (error) => {
        const entries = await readdir(join(generatedRoot, required)).catch(() => null);
        assert.ok(entries, `generated project is missing ${required}: ${error.message}`);
      });
    }
    await assert.rejects(
      access(join(generatedRoot, ".env")),
      /ENOENT/,
      "the scaffold must never copy the source instance's secrets",
    );
    await assert.rejects(
      access(join(generatedRoot, "next-env.d.ts")),
      /ENOENT/,
      "the scaffold must not package Next's generated next-env.d.ts",
    );
    await runPnpm(
      ["install", "--offline", "--frozen-lockfile", "--ignore-scripts"],
      generatedRoot,
    );
    await runPnpm(["typecheck"], generatedRoot);
    console.log(`Package artifact gate: ${tarballs.length} packed, installed and exercised.`);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

await main();
