// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Prove the separately published packages work outside the workspace.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readAlignedVersion } from "./release-packages.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageNames = [
  "create-freeholder",
  "@freeholder/plugin-kit",
  "@freeholder/sdk",
  "@freeholder/cli",
  "freeholder-app",
  "@freeholder/mobile-app",
  "@freeholder/templates",
];

/**
 * Run a command in the consumer project.
 *
 * `allowFailure` exists for one case: a CLI whose *exit code* is the thing
 * being tested. Rejecting on non-zero would make it impossible to assert that
 * `freeholder update` exits 3 when it cannot reach an instance, which is the
 * contract a crontab depends on.
 */
async function run(command, args, cwd, { allowFailure = false } = {}) {
  return new Promise((resolveRun, rejectRun) => {
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
      if (allowFailure) {
        resolveRun({ code: code ?? 0, output: `${stdout}${stderr}` });
        return;
      }
      if (code === 0) {
        resolveRun(stdout);
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
  await readAlignedVersion(repositoryRoot);
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
import { createClient, PLATFORM_VERSION, SERVICE_NAMES } from "@freeholder/sdk";
import { definePlugin } from "@freeholder/plugin-kit";
import { listPresets, preset } from "@freeholder/templates";
assert.equal(typeof createClient, "function");
assert.equal(typeof definePlugin, "function");
assert.match(PLATFORM_VERSION, /^\\d+\\.\\d+\\.\\d+/);
assert.ok(SERVICE_NAMES.includes("contacts.create"));
const client = createClient({
  baseUrl: "https://example.invalid",
  fetch: async () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } }),
});
assert.equal(typeof client.api.contacts.create, "function");
assert.deepEqual(listPresets().sort(), ["creator", "service-business", "shop"].sort());
const shop = preset("shop");
assert.ok(shop.pages.some((page) => page.blocks.some((block) => block.type === "heading")));
assert.ok(shop.emails.some((email) => email.blocks.length > 0));
assert.ok(shop.entities.some((entity) => entity.slug === "featured-product"));
`,
    );
    await run(process.execPath, [join(consumer, "smoke.mjs")], consumer);
    await writeFile(
      join(consumer, "consumer.mts"),
      `import { createClient, PLATFORM_VERSION, SERVICE_NAMES } from "@freeholder/sdk";
import { definePlugin } from "@freeholder/plugin-kit";
import { preset } from "@freeholder/templates";
const client = createClient({ baseUrl: "https://example.invalid" });
void client.api.contacts.list;
void SERVICE_NAMES;
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
    const created = await run(
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
    assert.match(created, /Setup URL: http:\/\/localhost:3000\/setup/);
    assert.match(created, /No \.env yet/);
    assert.match(created, /Skipped dependency install/);
    assert.match(created, /Skipped migrations/);
    assert.match(created, /Could not reach http:\/\/localhost:3000\/setup yet/);
    // The update CLI (C10.21) is exercised through its packed artifact too:
    // its exit codes are what a crontab reads, and an exit code that only
    // works from source is an exit code that stops working on install.
    const updateBin = join(
      consumer,
      "node_modules",
      ".bin",
      process.platform === "win32" ? "freeholder.cmd" : "freeholder",
    );
    await access(updateBin);
    const unreachable = await run(
      process.execPath,
      [
        join(consumer, "node_modules", "@freeholder", "cli", "dist", "index.js"),
        "update",
        "--check",
        "--url",
        "http://127.0.0.1:59599",
        "--api-key",
        "fh_artifact_gate",
      ],
      consumer,
      { allowFailure: true },
    );
    assert.match(unreachable.output, /Could not reach/);
    assert.equal(unreachable.code, 3);

    const appBin = join(
      consumer,
      "node_modules",
      ".bin",
      process.platform === "win32" ? "freeholder-app.cmd" : "freeholder-app",
    );
    await access(appBin);
    const appUnreachable = await run(
      process.execPath,
      [
        join(consumer, "node_modules", "freeholder-app", "dist", "index.js"),
        "init",
        "--url",
        "http://127.0.0.1:59599",
        "--dir",
        join(consumer, "mobile-init"),
      ],
      consumer,
      { allowFailure: true },
    );
    assert.match(appUnreachable.output, /Could not reach/);
    assert.equal(appUnreachable.code, 3);

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
