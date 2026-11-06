// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.44: package a built Freeholder as a self-contained Linux release tarball
// that runs without Docker, Node or pnpm on the server.
//
//   pnpm build && node scripts/build-release.mjs [--allow-dirty]
//
// The tarball holds the Next standalone server, its static assets, the
// migrations, the official Node runtime (checksum-verified against
// nodejs.org's SHASUMS256.txt), the `freeholder` operator command and the
// systemd/Caddy templates the installer writes. It is built for the machine's
// own architecture, because sharp's native binary in the standalone output is
// the build host's: linux-x64 on x64 runners, linux-arm64 on arm64 runners.
//
// Output in dist/release/: freeholder-<version>-linux-<arch>.tar.gz, its
// .sha256, and install.sh, which are the release assets the installer
// downloads.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, cp, mkdir, readFile, rm, stat, writeFile, mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const allowDirty = process.argv.includes("--allow-dirty");
const output = resolve(root, "dist", "release");
const nodeCache = resolve(root, ".tools", "node-runtime");

function run(command, args, options = {}) {
  return execFileSync(command, args, { cwd: root, encoding: "utf8", ...options });
}
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

export function releaseArch(arch = process.arch) {
  if (arch === "x64") return "x64";
  if (arch === "arm64") return "arm64";
  throw new Error(`Release tarballs are built for x64 and arm64 Linux, not ${arch}.`);
}

export function releaseName(version, arch) {
  if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) throw new Error(`Not a release version: ${version}`);
  return `freeholder-${version}-linux-${releaseArch(arch)}`;
}

async function download(url) {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) throw new Error(`Download of ${url} failed with HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

/** The official Node binary for this release, verified and cached. */
async function nodeRuntime(version, arch) {
  const name = `node-v${version}-linux-${arch}`;
  const directory = resolve(nodeCache, name);
  const recordPath = resolve(directory, "SOURCE.json");
  try {
    const record = JSON.parse(await readFile(recordPath, "utf8"));
    assert.equal(record.archive, `${name}.tar.xz`);
    assert.equal(record.binarySha256, sha256(await readFile(resolve(directory, "bin", "node"))));
    return { directory, record };
  } catch {
    await rm(directory, { recursive: true, force: true });
    await mkdir(nodeCache, { recursive: true });
  }
  const base = `https://nodejs.org/dist/v${version}`;
  const archiveName = `${name}.tar.xz`;
  const [archive, sums] = await Promise.all([download(`${base}/${archiveName}`), download(`${base}/SHASUMS256.txt`)]);
  const line = sums.toString("utf8").split(/\r?\n/).find((entry) => entry.endsWith(`  ${archiveName}`));
  if (!line) throw new Error(`nodejs.org lists no checksum for ${archiveName}`);
  const expected = line.split(/\s+/)[0];
  assert.equal(sha256(archive), expected, "Node runtime checksum mismatch");
  const temporary = await mkdtemp(join(tmpdir(), "freeholder-node-"));
  try {
    const archivePath = join(temporary, archiveName);
    await writeFile(archivePath, archive);
    run("tar", ["-xJf", archivePath, "-C", nodeCache, `${name}/bin/node`, `${name}/LICENSE`]);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
  const record = {
    version,
    archive: archiveName,
    archiveSha256: expected,
    binarySha256: sha256(await readFile(resolve(directory, "bin", "node"))),
    source: `${base}/${archiveName}`,
  };
  await writeFile(recordPath, `${JSON.stringify(record, null, 2)}\n`);
  return { directory, record };
}

async function exists(path) {
  return stat(path).then(() => true, () => false);
}

async function main() {
  if (process.platform !== "linux") throw new Error("Build Linux release tarballs on Linux.");
  const arch = releaseArch();
  const dirty = run("git", ["status", "--porcelain"]).trim().length > 0;
  if (dirty && !allowDirty) throw new Error("Refusing to package a dirty tree; commit first or pass --allow-dirty for a local test build.");
  const pkg = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
  const version = pkg.version;
  const commit = run("git", ["rev-parse", "HEAD"]).trim();
  const nodeVersion = (await readFile(resolve(root, ".node-version"), "utf8")).trim();
  const standalone = resolve(root, ".next", "standalone");
  if (!(await exists(resolve(standalone, "server.js")))) throw new Error("Run pnpm build first: .next/standalone/server.js is missing.");
  // sharp ships a per-architecture binary; a tarball carrying another
  // machine's would fail on the first image upload, not at install.
  const pnpmStore = await readdir(resolve(standalone, "node_modules", ".pnpm")).catch(() => []);
  if (pnpmStore.some((entry) => entry.startsWith("sharp@")) && !pnpmStore.some((entry) => entry.startsWith(`@img+sharp-linux-${arch}@`))) {
    throw new Error(`The standalone output has no sharp binary for linux-${arch}; build on a linux-${arch} machine.`);
  }

  const name = releaseName(version, arch);
  const stage = resolve(output, name);
  await rm(stage, { recursive: true, force: true });
  await mkdir(resolve(stage, "app", ".next"), { recursive: true });
  // The same files the Docker runtime stage copies (Dockerfile).
  await cp(standalone, resolve(stage, "app"), { recursive: true, verbatimSymlinks: true });
  await cp(resolve(root, ".next", "static"), resolve(stage, "app", ".next", "static"), { recursive: true });
  await cp(resolve(root, "public"), resolve(stage, "app", "public"), { recursive: true });
  await cp(resolve(root, "db"), resolve(stage, "app", "db"), { recursive: true });
  await mkdir(resolve(stage, "app", "scripts"), { recursive: true });
  await cp(resolve(root, "scripts", "owner-password.mjs"), resolve(stage, "app", "scripts", "owner-password.mjs"));
  // Next writes its runtime cache here. The installer points it at a
  // directory the service may write, so the release itself stays read-only.
  await rm(resolve(stage, "app", ".next", "cache"), { recursive: true, force: true });

  const runtime = await nodeRuntime(nodeVersion, arch);
  await mkdir(resolve(stage, "runtime", "node", "bin"), { recursive: true });
  await cp(resolve(runtime.directory, "bin", "node"), resolve(stage, "runtime", "node", "bin", "node"));
  await cp(resolve(runtime.directory, "LICENSE"), resolve(stage, "runtime", "node", "LICENSE"));

  await mkdir(resolve(stage, "bin"), { recursive: true });
  await cp(resolve(root, "deploy", "linux", "freeholder"), resolve(stage, "bin", "freeholder"));
  await chmod(resolve(stage, "bin", "freeholder"), 0o755);
  await cp(resolve(root, "deploy", "linux", "share"), resolve(stage, "share"), { recursive: true });
  await cp(resolve(root, "deploy", "linux", "install.sh"), resolve(stage, "share", "install.sh"));
  await cp(resolve(root, "LICENSE"), resolve(stage, "LICENSE"));
  await cp(resolve(root, "NOTICE"), resolve(stage, "NOTICE"));

  const release = {
    schema: "freeholder/linux-release/v1",
    version,
    commit,
    platform: `linux-${arch}`,
    node: { version: nodeVersion, source: runtime.record.source, archiveSha256: runtime.record.archiveSha256 },
  };
  await writeFile(resolve(stage, "RELEASE.json"), `${JSON.stringify(release, null, 2)}\n`);
  await writeFile(resolve(stage, "VERSION"), `${version}\n`);

  const tarball = resolve(output, `${name}.tar.gz`);
  // Root-owned, sorted and dated by the commit so two builds of one commit
  // differ only where the toolchain does.
  const date = run("git", ["show", "-s", "--format=%cI", "HEAD"]).trim();
  run("tar", ["--sort=name", `--mtime=${date}`, "--owner=0", "--group=0", "--numeric-owner", "-czf", tarball, "-C", output, name]);
  const digest = sha256(await readFile(tarball));
  await writeFile(`${tarball}.sha256`, `${digest}  ${name}.tar.gz\n`);
  await cp(resolve(root, "deploy", "linux", "install.sh"), resolve(output, "install.sh"));
  await rm(stage, { recursive: true, force: true });
  const bytes = (await stat(tarball)).size;
  console.log(`release: ${name}.tar.gz (${(bytes / 1048576).toFixed(1)} MB) sha256 ${digest}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
