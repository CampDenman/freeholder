// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
// The licensing gate (LICENSING.md, CLAUDE.md non-negotiables). Every source
// file carries a copyright line and an SPDX identifier, and the identifier
// must match which side of the AGPL/MIT boundary the file is on. Getting this
// wrong is not a style slip: it is the licensing boundary the whole project
// rests on, so it is checked rather than remembered.
//
// Usage: node scripts/license-headers.mjs [--fix]
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const COPYRIGHT = "Copyright (C) 2026 Tony Aly";
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

const files = [...tracked.split("\n"), ...untracked.split("\n")]
  .filter(Boolean)
  .filter((f) => !EXEMPT.some((rx) => rx.test(f)))
  .filter((f) => commentStyle(f));

const problems = [];

for (const file of files) {
  const [prefix, suffix] = commentStyle(file);
  // packages/* is MIT, everything else in the repo is AGPL (LICENSING.md).
  const license = file.startsWith("packages/") ? "MIT" : "AGPL-3.0-only";
  const spdx = `SPDX-License-Identifier: ${license}`;

  const original = readFileSync(file, "utf8");
  const body = original.replace(/^﻿/, "");

  const header = body.split("\n").slice(0, 5).join("\n");
  const hasCopyright = header.includes(COPYRIGHT);
  const hasSpdx = header.includes(spdx);
  const hasWrongSpdx = /SPDX-License-Identifier: \S+/.test(header) && !hasSpdx;

  if (hasCopyright && hasSpdx) continue;

  if (hasWrongSpdx) {
    // Never auto-rewrite a license: a mismatch here means code may have moved
    // across the AGPL/MIT boundary, which is a decision, not a typo.
    problems.push(`${file}: declares a different license; expected ${license}`);
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

if (problems.length > 0) {
  console.error(
    `License headers (LICENSING.md): ${problems.length} file(s) need attention.\n` +
      problems.map((p) => `  ${p}`).join("\n") +
      "\n\nRun `pnpm license:fix` to add the missing headers.",
  );
  process.exit(1);
}
console.log(`License headers: ${files.length} files OK.`);
