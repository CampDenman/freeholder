// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Answer one question before editing a file: which deploy/*.json source
// records pin its sha256, and are they still accurate?
//
// WHY THIS EXISTS
// ---------------
// `tests/helpers/row-hash-ledger-forward.ts` walks 124 source records, and
// several tests reverse ladders of them -- `controlled-safe-response-composition87`
// and `tests/core/migrate-boundary.test.ts` are the deepest. A one-line repair
// to a covered file therefore turns other suites red, and the failure names a
// sha rather than the file that moved. That has already cost real time twice:
//   - 47edf53e, a correct money-ancestry fix, changed four lines of a test and
//     reddened `composition87` and `controlled-cash-origin-old-protocol88-source`;
//   - an attempt to narrow the migration-boundary freeze was reverted once
//     because the ladder under it had not been mapped first.
//
// Run this BEFORE editing, and again after, so the records move with the code.
//
//   node scripts/pinned-source-records.mjs tests/core/migrate-boundary.test.ts
//
// MATCHES means that value equals the file's current sha256. STALE means it
// does not -- which is expected and correct for a `beforeSha256`, because a
// predecessor is derived by reversing that record's own edits, not by hashing
// the file. Read it as "this value refers to some other state", then decide.
//
// Three things it will not do, each learned the hard way:
//   - It does not edit anything. A sha that looks replaceable may be a
//     historical fact: `preUpgrade.testSha256` in
//     controlled-cash-origin-old-protocol88.source.json held the same value as
//     a predecessor, and is the blob sha at a pinned commit. Verify with
//     `git show <commit>:<path> | sha256sum` before touching a value.
//   - It does not tell you whether a record is ASSERTED. Some are archival and
//     have no reader; grep tests/ src/ scripts/ for the record name.
//   - It cannot know a record's own serialization. Several declare
//     `archivalEncoding` and escape every period as a JSON Unicode escape;
//     re-serializing such a file with a JSON writer silently discards that,
//     so edit those as text.
//
// There is deliberately no `package.json` script alias for this. One was
// added and reverted: `package.json` is itself covered, so the alias broke
// `controlled-safe-response-composition87` through
// source-continuity-current108-20261116.source.json. The tool caught its own
// author, which is the point, and an alias is not worth re-anchoring a ladder.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const target = process.argv[2];
if (!target) {
  console.error("usage: node scripts/pinned-source-records.mjs <path-in-repo>");
  process.exit(2);
}

const current = createHash("sha256").update(readFileSync(target)).digest("hex");
console.log(`${target}\n  current sha256: ${current}\n`);

const SHA256 = /^[0-9a-f]{64}$/;
const hits = [];

for (const name of readdirSync("deploy").filter(file => file.endsWith(".json")).sort()) {
  const path = join("deploy", name);
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    continue;
  }
  if (!text.includes(target)) continue;
  let document;
  try {
    document = JSON.parse(text);
  } catch {
    hits.push({ name, where: "unparseable JSON", sha: null });
    continue;
  }
  const found = [];
  const walk = (node, trail) => {
    if (Array.isArray(node)) {
      node.forEach((value, index) => walk(value, `${trail}[${index}]`));
      return;
    }
    if (node === null || typeof node !== "object") return;
    if (node.path === target) {
      for (const [key, value] of Object.entries(node)) {
        if (typeof value === "string" && SHA256.test(value)) found.push({ key: `${trail || "root"}.${key}`, value });
      }
    }
    for (const [key, value] of Object.entries(node)) walk(value, trail ? `${trail}.${key}` : key);
  };
  walk(document, "");
  if (found.length === 0) hits.push({ name, where: "named, but no sha256 on that path", sha: null });
  else for (const { key, value } of found) hits.push({ name, where: key, sha: value });
}

if (hits.length === 0) console.log("  not pinned by any deploy record");
for (const { name, where, sha } of hits) {
  const flag = sha === null ? "" : sha === current ? "  MATCHES current" : "  STALE vs current";
  console.log(`  ${name}\n      ${where} = ${sha ?? "(none)"}${flag}`);
}
