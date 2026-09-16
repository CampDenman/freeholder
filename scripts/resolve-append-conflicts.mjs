// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Resolve the three collisions every branch has, by meaning rather than by text.
//
// `locales/*.json` and `db/migrations/meta/_journal.json` are append-only
// records that two branches both extend. A textual three-way merge has no way
// to know that, so it fights over the tail and — because the conflict region
// can span the closing brace — regularly produces invalid JSON that then has
// to be repaired by hand, on files with four and a half thousand entries.
//
// The honest resolution is never "pick a side". It is "keep what main has, and
// add what this branch added", which is computable from the three stages git
// already staged for us:
//
//   :1: the merge base   :2: ours (main, during a rebase)   :3: theirs
//
// So an added key is one in `theirs` that the base did not have. Everything
// else stays exactly as main has it.
//
// What this deliberately will NOT do is resolve a *real* disagreement. If both
// sides changed the same key to different values, that is two branches
// disagreeing about one string, and a script picking a winner would bury it —
// so it says so and leaves the file for a person.
//
// Usage: run inside the conflicted worktree, mid-rebase or mid-merge.
//
//   node scripts/resolve-append-conflicts.mjs
//
// Then check the result (`git diff`), `git add -A`, and continue.
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

/** One stage of a conflicted path, or null when git has no such stage. */
function stage(path, n) {
  try {
    return execFileSync("git", ["show", `:${n}:${path}`], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch {
    return null;
  }
}

function conflicted() {
  return execFileSync("git", ["diff", "--name-only", "--diff-filter=U"], {
    encoding: "utf8",
  })
    .split("\n")
    .filter(Boolean);
}

/**
 * Locale files, which are not sorted.
 *
 * Insertion order is preserved so the file keeps reading as it did: the keys
 * run in the order features were built, and re-sorting would rewrite thousands
 * of lines and bury the change.
 */
function resolveLocale(path, problems) {
  const base = JSON.parse(stage(path, 1) ?? "{}");
  const ours = JSON.parse(stage(path, 2) ?? "{}");
  const theirs = JSON.parse(stage(path, 3) ?? "{}");

  const merged = { ...ours };
  let added = 0;
  for (const [key, value] of Object.entries(theirs)) {
    if (!(key in base)) {
      if (!(key in merged)) added += 1;
      merged[key] = value;
      continue;
    }
    // Both sides moved the same existing string somewhere different. That is a
    // decision, not an append, and it is not this script's to make.
    if (key in ours && ours[key] !== theirs[key] && base[key] !== theirs[key]) {
      problems.push(`${path}: both sides changed ${JSON.stringify(key)}`);
    }
  }

  const text = `{\n${Object.entries(merged)
    .map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`)
    .join(",\n")}\n}\n`;
  JSON.parse(text); // Refuse to write something that is not valid JSON.
  writeFileSync(path, text);
  console.log(`  ${path}: kept ${Object.keys(ours).length} from ours, added ${added}`);
}

/**
 * The migration journal, ordered by `idx` rather than by who merged first.
 *
 * Two branches reserve different numbers, so both entries survive; sorting by
 * index keeps the file readable and matches the order the migrations will run.
 */
function resolveJournal(path) {
  const ours = JSON.parse(stage(path, 2) ?? "{}");
  const theirs = JSON.parse(stage(path, 3) ?? "{}");
  const seen = new Set(ours.entries.map((entry) => entry.tag));
  const added = theirs.entries.filter((entry) => !seen.has(entry.tag));
  const merged = { ...ours, entries: [...ours.entries, ...added] };
  merged.entries.sort((a, b) => a.idx - b.idx);

  const numbers = merged.entries.map((entry) => entry.idx);
  const duplicate = numbers.find((n, i) => numbers.indexOf(n) !== i);
  if (duplicate !== undefined) {
    // Two branches took the same migration number. Nothing downstream can fix
    // that, and applying them in either order is wrong.
    throw new Error(
      `Two migrations both claim index ${duplicate}. Renumber one of them before continuing.`,
    );
  }

  writeFileSync(path, `${JSON.stringify(merged, null, 2)}\n`);
  console.log(`  ${path}: added ${added.map((e) => e.tag).join(", ") || "nothing"}`);
}

const problems = [];
const untouched = [];

for (const path of conflicted()) {
  if (/^locales\/.*\.json$/.test(path)) resolveLocale(path, problems);
  else if (path.endsWith("_journal.json")) resolveJournal(path);
  else untouched.push(path);
}

for (const problem of problems) console.warn(`  ! ${problem}`);
if (untouched.length > 0) {
  console.log(`\nNot append-only, so left for you:\n${untouched.map((p) => `  ${p}`).join("\n")}`);
}
if (problems.length > 0) {
  console.error("\nSome keys were changed on both sides. Look at those before continuing.");
  process.exit(1);
}
