// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The licensing gate (LICENSING.md, CLAUDE.md non-negotiables). Every
// Freeholder-authored source file carries the same copyright line and Apache
// SPDX identifier. Package manifests and their distributable license texts
// are checked here too, so published packages cannot drift from the repository.
//
// Usage: node scripts/license-headers.mjs [--fix]
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const COPYRIGHT = "Copyright (C) 2026 Tony Aly";
const LICENSE_ID = "Apache-2.0";
const CANONICAL_LICENSE_SHA256 =
  "cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30";
const fix = process.argv.includes("--fix");

// Generated files carry no header, because whatever generates them will
// silently drop it and fail this check on the next unrelated change — drizzle
// rewrites migrations wholesale, and any dependency change rewrites the
// lockfile. JSON has no comment syntax at all.
const EXEMPT = [
  /^db\/migrations\//,
  /\.json$/,
  /^next-env\.d\.ts$/,
  /(^|\/)pnpm-lock\.yaml$/,
  /(^|\/)package-lock\.json$/,
  /(^|\/)yarn\.lock$/,
];

const COMMENT = {
  ts: ["//", ""],
  tsx: ["//", ""],
  mts: ["//", ""],
  mjs: ["//", ""],
  js: ["//", ""],
  css: ["/*", " */"],
  sh: ["#", ""],
  yml: ["#", ""],
  yaml: ["#", ""],
};

function commentStyle(file) {
  const basename = file.split("/").pop();
  if (
    basename === "Dockerfile" ||
    basename === "Caddyfile" ||
    basename === ".dockerignore" ||
    basename === ".env.example"
  ) return ["#", ""];
  return COMMENT[file.split(".").pop() ?? ""];
}

const tracked = execFileSync("git", ["ls-files"], { encoding: "utf8" });
const untracked = execFileSync(
  "git",
  ["ls-files", "--others", "--exclude-standard"],
  { encoding: "utf8" },
);

const repositoryFiles = [...tracked.split("\n"), ...untracked.split("\n")]
  .filter(Boolean);

const files = repositoryFiles
  .filter((f) => !EXEMPT.some((rx) => rx.test(f)))
  .filter((f) => commentStyle(f));

const problems = [];

for (const file of files) {
  const [prefix, suffix] = commentStyle(file);
  const spdx = `SPDX-License-Identifier: ${LICENSE_ID}`;

  const original = readFileSync(file, "utf8");
  const body = original.replace(/^﻿/, "");

  const header = body.split("\n").slice(0, 5).join("\n");
  const hasCopyright = header.includes(COPYRIGHT);
  const hasSpdx = header.includes(spdx);
  const hasWrongSpdx = /SPDX-License-Identifier: \S+/.test(header) && !hasSpdx;

  if (hasCopyright && hasSpdx) continue;

  if (hasWrongSpdx) {
    // Never auto-relicense a file: an unexpected identifier may belong to
    // third-party code and needs a human copyright/licensing decision.
    problems.push(`${file}: declares a different license; expected ${LICENSE_ID}`);
    continue;
  }

  if (!fix) {
    problems.push(
      `${file}: missing ${!hasCopyright ? "copyright line" : ""}${!hasCopyright && !hasSpdx ? " and " : ""}${!hasSpdx ? "SPDX identifier" : ""}`,
    );
    continue;
  }

  const lines = [];
  if (!hasCopyright) lines.push(`${prefix} ${COPYRIGHT}${suffix}`);
  if (!hasSpdx) lines.push(`${prefix} ${spdx}${suffix}`);
  // Insert above an existing SPDX line so the two stay adjacent, else at top.
  const spdxLine = body.split("\n").findIndex((l) => l.includes("SPDX-License-Identifier"));
  const out = body.split("\n");
  out.splice(spdxLine >= 0 ? spdxLine : 0, 0, ...lines);
  writeFileSync(file, out.join("\n"));
  console.log(`fixed ${file}`);
}

const manifests = repositoryFiles.filter(
  (file) => file === "package.json" || /^packages\/[^/]+\/package\.json$/.test(file),
);

for (const file of manifests) {
  const manifest = JSON.parse(readFileSync(file, "utf8"));
  if (manifest.license !== LICENSE_ID) {
    problems.push(
      `${file}: declares ${String(manifest.license)}; expected ${LICENSE_ID}`,
    );
  }
}

const rootLicense = readFileSync("LICENSE", "utf8");
const normalizedRootLicense = rootLicense.replaceAll("\r\n", "\n");
const rootLicenseHash = createHash("sha256")
  .update(normalizedRootLicense)
  .digest("hex");
if (rootLicenseHash !== CANONICAL_LICENSE_SHA256) {
  problems.push("LICENSE: expected the complete Apache License 2.0 text");
}

const licenseFiles = manifests.map((manifest) =>
  manifest.replace(/package\.json$/, "LICENSE"),
);
for (const file of licenseFiles) {
  if (!repositoryFiles.includes(file)) {
    problems.push(`${file}: every package must ship the repository license`);
    continue;
  }
  if (readFileSync(file, "utf8") !== rootLicense) {
    problems.push(`${file}: must be byte-identical to the root LICENSE`);
  }
}

if (problems.length > 0) {
  console.error(
    `License headers (LICENSING.md): ${problems.length} file(s) need attention.\n` +
      problems.map((p) => `  ${p}`).join("\n") +
      "\n\nRun `pnpm license:fix` to add missing headers; review metadata or " +
      "license-text mismatches manually.",
  );
  process.exit(1);
}
console.log(
  `Licensing: ${files.length} source files, ${manifests.length} manifests, ` +
    `and ${licenseFiles.length} license texts OK.`,
);
