// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Compile the CLI and bundle the exact source distribution it scaffolds.
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(packageRoot, "../..");
const outputRoot = join(packageRoot, "dist");
const templateOutputRoot = join(outputRoot, "template");

const rootFiles = [
  ".dockerignore",
  ".env.example",
  ".node-version",
  ".replit",
  "CODE_OF_CONDUCT.md",
  "CONTRIBUTING.md",
  "DCO.md",
  "Dockerfile",
  "LICENSING.md",
  "LICENSE",
  "MASTER.md",
  "README.md",
  "SECURITY.md",
  "drizzle.config.ts",
  "eslint.config.mjs",
  "freeholder.config.ts",
  "instrumentation.node.ts",
  "instrumentation.ts",
  "next.config.ts",
  "package.json",
  "playwright.a11y.config.ts",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "postcss.config.mjs",
  "proxy.ts",
  "render.yaml",
  "replit.nix",
  "tsconfig.json",
  "vitest.config.ts",
];

const rootDirectories = [
  ".changeset",
  ".github",
  ".railway",
  "app",
  "db",
  "deploy",
  "locales",
  "packages",
  "plugins",
  "public",
  "scripts",
  "security",
  "seed",
  "src",
  "tests",
];

const excludedSegments = new Set(["dist", "node_modules", ".next", "test-results"]);

function includeSource(source) {
  const parts = relative(repositoryRoot, source).split(sep);
  return !parts.some((part) => excludedSegments.has(part));
}

async function runTypeScript() {
  const tsc = join(repositoryRoot, "node_modules", "typescript", "bin", "tsc");
  await new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, [tsc, "-p", join(packageRoot, "tsconfig.json")], {
      cwd: repositoryRoot,
      stdio: "inherit",
      shell: false,
    });
    child.on("error", rejectRun);
    child.on("exit", (code, signal) => {
      if (code === 0) resolveRun();
      else rejectRun(new Error(`TypeScript failed${signal ? ` (${signal})` : ` with exit ${code}`}.`));
    });
  });
}

async function filesBelow(root, current = root) {
  const entries = await readdir(current, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(current, entry.name);
      return entry.isDirectory() ? filesBelow(root, path) : [relative(root, path).split(sep).join("/")];
    }),
  );
  return nested.flat();
}

async function writeIntegrityManifest(templateRoot) {
  const files = (await filesBelow(templateRoot)).sort();
  const entries = [];
  for (const path of files) {
    const bytes = await readFile(join(templateRoot, ...path.split("/")));
    entries.push({
      path,
      bytes: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
  }
  const platform = JSON.parse(await readFile(join(repositoryRoot, "package.json"), "utf8"));
  await writeFile(
    join(outputRoot, "template-manifest.json"),
    `${JSON.stringify(
      {
        schema: "freeholder-source-template/v1",
        platformVersion: platform.version,
        files: entries,
      },
      null,
      2,
    )}\n`,
  );
}

await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });
await runTypeScript();
const scratch = await mkdtemp(join(tmpdir(), "create-freeholder-build-"));
const templateRoot = join(scratch, "template");
try {
  await mkdir(templateRoot, { recursive: true });
  for (const file of rootFiles) {
    await cp(join(repositoryRoot, file), join(templateRoot, file));
  }
  // npm pack interprets a nested .gitignore as package exclusions. Preserve
  // the owner's ignore file under a neutral name and restore it in the CLI.
  await cp(join(repositoryRoot, ".gitignore"), join(templateRoot, "gitignore.template"));
  for (const directory of rootDirectories) {
    await cp(join(repositoryRoot, directory), join(templateRoot, directory), {
      recursive: true,
      filter: includeSource,
    });
  }
  await writeIntegrityManifest(templateRoot);
  await rename(templateRoot, templateOutputRoot);
} finally {
  await rm(scratch, { recursive: true, force: true });
}
