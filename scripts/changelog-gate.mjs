// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
// The changelog gate (MASTER.md §15.6): a PR that touches functionality must
// carry a changeset entry. Release notes are religion — undocumented
// functionality changes are treated as bugs.
//
// Usage: node scripts/changelog-gate.mjs <base-ref>
import { execSync } from "node:child_process";

const base = process.argv[2] ?? "origin/main";
const diff = execSync(`git diff --name-only ${base}...HEAD`, {
  encoding: "utf8",
})
  .split("\n")
  .filter(Boolean);

const functional = diff.filter(
  (f) =>
    (f.startsWith("app/") || f.startsWith("src/")) &&
    !f.endsWith(".test.ts") &&
    !f.endsWith(".md"),
);
const hasChangeset = diff.some(
  (f) => f.startsWith(".changeset/") && f.endsWith(".md") && !f.endsWith("README.md"),
);

if (functional.length > 0 && !hasChangeset) {
  console.error(
    "Changelog gate (MASTER.md §15.6): this change touches functionality " +
      "but ships no changeset.\n\nFunctional files changed:\n" +
      functional.map((f) => `  ${f}`).join("\n") +
      "\n\nRun `pnpm changeset` and write one plain-English sentence a " +
      "business owner can understand.",
  );
  process.exit(1);
}
console.log(
  functional.length === 0
    ? "Changelog gate: no functional changes — no changeset required."
    : "Changelog gate: changeset present.",
);
