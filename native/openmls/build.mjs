// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.39: deployments consume committed WASM; only this build needs Rust.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const crate = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(crate, "../..");
const destination = path.join(root, "public/_freeholder/openmls/0.1.0");
const check = process.argv.includes("--check");
const temp = mkdtempSync(path.join(tmpdir(), "freeholder-openmls-build-"));
const cargo = process.env.CARGO ?? "cargo";
const bindgen = process.env.WASM_BINDGEN ?? "wasm-bindgen";
const sha = value => createHash("sha256").update(value).digest("hex");
const baseEnv = { ...process.env, CARGO_INCREMENTAL: "0", SOURCE_DATE_EPOCH: "0" };
function run(command, args, env = baseEnv) {
  return execFileSync(command, args, { cwd: crate, env, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
}
function requireVersion(command, expected, args = ["--version"]) {
  if (run(command, args).trim() !== expected) throw new Error(`Expected ${expected}`);
}
try {
  requireVersion(cargo, "cargo 1.99.1 (5f94df478 2026-08-27)");
  requireVersion(bindgen, "wasm-bindgen 0.2.130");
  const cargoHome = process.env.CARGO_HOME ?? path.join(process.env.HOME, ".cargo");
  const env = {
    ...baseEnv,
    RUSTFLAGS: `--cfg getrandom_backend="wasm_js" --remap-path-prefix=${root}=/freeholder --remap-path-prefix=${cargoHome}=/cargo`,
  };
  run(cargo, ["build", "--locked", "--lib", "--target", "wasm32-unknown-unknown", "--release"], env);
  const target = process.env.CARGO_TARGET_DIR ? path.resolve(crate, process.env.CARGO_TARGET_DIR) : path.join(crate, "target");
  run(bindgen, [path.join(target, "wasm32-unknown-unknown/release/freeholder_openmls.wasm"), "--target", "web", "--out-dir", temp, "--typescript"]);

  const metadata = JSON.parse(run(cargo, ["metadata", "--locked", "--format-version", "1", "--filter-platform", "wasm32-unknown-unknown"]));
  const tree = new Set(run(cargo, ["tree", "--locked", "--target", "wasm32-unknown-unknown", "--edges", "normal,build", "--prefix", "none", "--format", "{p}"])
    .split("\n").map(line => line.replace(/ \(.*$/, "")));
  const packages = metadata.packages.filter(pkg => pkg.name !== "freeholder-openmls" && tree.has(`${pkg.name} v${pkg.version}`))
    .sort((a, b) => a.name.localeCompare(b.name, "en") || a.version.localeCompare(b.version, "en"));
  const licenses = [];
  const dependencies = [];
  const files = ["freeholder_openmls.js", "freeholder_openmls.d.ts", "freeholder_openmls_bg.wasm"];
  for (const pkg of packages) {
    const registry = pkg.source?.startsWith("registry+");
    const upstream = pkg.source?.startsWith("git+https://github.com/openmls/openmls?") && pkg.source.endsWith("#6100df3fb1d8c3eeab53e349fcbd621f98c44fe2");
    if ((!registry && !upstream) || !pkg.license) throw new Error(`Unreviewed crate source or license: ${pkg.name}`);
    const source = registry ? `https://static.crates.io/crates/${pkg.name}/${pkg.name}-${pkg.version}.crate` : "https://github.com/openmls/openmls/tree/6100df3fb1d8c3eeab53e349fcbd621f98c44fe2";
    const directory = path.dirname(pkg.manifest_path);
    const texts = readdirSync(directory).sort().filter(name => /^(licen[cs]e|copying|notice)/i.test(name) && statSync(path.join(directory, name)).isFile())
      .map(name => `${name}\n${readFileSync(path.join(directory, name), "utf8").trim()}`);
    if (!texts.length) {
      if (pkg.name.startsWith("openmls")) texts.push(readFileSync(path.join(crate, "licenses/OpenMLS-MIT.txt"), "utf8"));
      else if (pkg.license === "Apache-2.0") texts.push(readFileSync(path.join(root, "LICENSE"), "utf8"));
      else if (pkg.license === "MPL-2.0") texts.push(readFileSync(path.join(crate, "licenses/MPL-2.0.txt"), "utf8"));
      else throw new Error(`Missing license text: ${pkg.name}`);
    }
    const item = { name: pkg.name, version: pkg.version, license: pkg.license, authors: pkg.authors, repository: pkg.repository, source };
    if (pkg.license === "MPL-2.0") {
      // Redistribute the exact unmodified source archives beside the binary.
      const archive = `${pkg.name}-${pkg.version}.crate`;
      const cached = path.join(path.dirname(path.dirname(path.dirname(directory))), "cache", path.basename(path.dirname(directory)), archive);
      copyFileSync(cached, path.join(temp, archive));
      files.push(archive);
      item.sourceArchive = archive;
    }
    dependencies.push(item);
    licenses.push(`${pkg.name} ${pkg.version}\nLicense: ${pkg.license}\nAuthors: ${pkg.authors.join(", ")}\nSource: ${source}\n\n${texts.join("\n\n")}`);
  }
  writeFileSync(path.join(temp, "NOTICE.txt"), `Freeholder OpenMLS WebAssembly binding 0.1.0\nCopyright (C) 2026 Tony Aly; Apache-2.0 (see LICENSE.txt).\n\nGenerated JavaScript is produced by wasm-bindgen 0.2.130 (MIT OR Apache-2.0).\nThird-party code keeps the licenses reproduced below. Dependency inventory includes\ntransitive runtime and compile-time build/procedural-macro dependencies.\n\nMPL-2.0 HPKE crates are unmodified. Their complete corresponding source archives\nare distributed beside this notice at the filenames in dependencies.json.\nFreeholder's larger work and thin binding remain Apache-2.0.\n\n${licenses.join("\n\n----------------------------------------\n\n")}\n`);
  writeFileSync(path.join(temp, "dependencies.json"), JSON.stringify(dependencies, null, 2) + "\n");
  writeFileSync(path.join(temp, "LICENSE.txt"), readFileSync(path.join(root, "LICENSE")));
  writeFileSync(path.join(temp, "package.json"), JSON.stringify({ private: true, type: "module" }, null, 2) + "\n");
  files.push("NOTICE.txt", "dependencies.json", "LICENSE.txt", "package.json");
  const hashes = Object.fromEntries(files.sort().map(name => [name, sha(readFileSync(path.join(temp, name)))]));
  const inputs = ["Cargo.toml", "Cargo.lock", "rust-toolchain.toml", "src/lib.rs", "build.mjs", "licenses/OpenMLS-MIT.txt", "licenses/MPL-2.0.txt"];
  writeFileSync(path.join(temp, "manifest.json"), JSON.stringify({ version: 1, rust: "1.99.1", wasmBindgen: "0.2.130", inputs: Object.fromEntries(inputs.map(name => [name, sha(readFileSync(path.join(crate, name)))])), files: hashes }, null, 2) + "\n");
  files.push("manifest.json");
  mkdirSync(destination, { recursive: true });
  for (const name of readdirSync(destination)) {
    if (files.includes(name)) continue;
    if (check) throw new Error(`Unexpected committed OpenMLS artifact: ${name}`);
    rmSync(path.join(destination, name), { recursive: true, force: true });
  }
  for (const name of files) {
    const generated = readFileSync(path.join(temp, name));
    if (check) {
      if (!existsSync(path.join(destination, name)) || !generated.equals(readFileSync(path.join(destination, name)))) throw new Error(`Committed OpenMLS artifact is stale: ${name}`);
    } else writeFileSync(path.join(destination, name), generated);
  }
  console.log(`OpenMLS ${check ? "verified" : "generated"}: ${files.length} artifacts, ${packages.length} dependencies.`);
} finally {
  rmSync(temp, { recursive: true, force: true });
}
