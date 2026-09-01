// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The schema-compatibility gate (MASTER.md §15.9, §39.5).
//
// Rollback is an image swap — no restore, no data loss — and that is true only
// while a release's schema stays readable by the release before it. Expand,
// then contract: add the column, ship code that tolerates both shapes, drop the
// old one a release later.
//
// This gate cannot prove a migration is compatible; nothing can, short of
// running the previous release against it (which the upgrade gate does). What
// it can do is refuse the statements that are *known* to break the previous
// release unless somebody has said out loud that they are doing it — which
// turns a silent breakage into a deliberate one, and is the whole difference
// between an updater an owner can leave on and one they cannot.
//
// Usage: node scripts/schema-compat-gate.mjs [<base-ref>]
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

/**
 * Statements that a previous release cannot survive.
 *
 * Each is a thing the old code will still reference: a table or column it
 * selects, a type it casts, a name it knows, or a NOT NULL it has no value
 * for. Additive DDL — new tables, nullable columns, indexes, defaults —
 * is absent on purpose, because that is precisely what expand-then-contract
 * asks people to do instead.
 */
const BREAKING = [
  {
    id: "drop-table",
    rx: /\bDROP\s+TABLE\b/i,
    why: "the previous release still selects from it",
  },
  {
    id: "drop-column",
    rx: /\bDROP\s+COLUMN\b/i,
    why: "the previous release still reads it",
  },
  {
    id: "rename",
    rx: /\bRENAME\s+(TO|COLUMN|CONSTRAINT)\b/i,
    why: "a rename is a drop and an add to anything holding the old name",
  },
  {
    id: "retype-column",
    rx: /\bALTER\s+COLUMN\b[\s\S]{0,80}?\b(SET\s+DATA\s+)?TYPE\b/i,
    why: "the previous release will read or write the old type",
  },
  {
    id: "not-null-without-default",
    // A NOT NULL added to an existing column, with no default to fill it: the
    // previous release inserts rows without that column and every write fails.
    rx: /\bALTER\s+COLUMN\b[\s\S]{0,80}?\bSET\s+NOT\s+NULL\b/i,
    why: "the previous release inserts rows that do not set it",
  },
  {
    id: "add-required-column",
    rx: /\bADD\s+COLUMN\b(?![\s\S]{0,200}?\bDEFAULT\b)[\s\S]{0,200}?\bNOT\s+NULL\b/i,
    why: "a required column with no default rejects the previous release's inserts",
  },
];

/**
 * The opt-out. Deliberately verbose — it should be visible in a diff.
 *
 * The reason must be on the marker's own line: `\s` would otherwise swallow
 * the newline and read the migration's first statement as the explanation,
 * which turns a bare checkbox into a passing gate.
 */
const ACKNOWLEDGEMENT = /--[^\S\n]*freeholder:schema-breaking(?:[^\S\n]+([^\n]*))?/i;

/**
 * Strip comments before matching, so an explanatory `-- we do not DROP COLUMN
 * here` cannot trip the gate, and a statement cannot hide inside a comment.
 */
export function stripComments(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ");
}

/**
 * Every known-breaking statement in one migration's SQL.
 *
 * Matched per statement rather than across the whole file, so a later
 * `ADD COLUMN ... DEFAULT` cannot vouch for an earlier one that has none.
 */
export function findBreakingStatements(sql) {
  const statements = stripComments(sql)
    .split(/;|--> statement-breakpoint/)
    .filter((s) => s.trim());
  const found = new Map();
  for (const statement of statements) {
    for (const { id, rx, why } of BREAKING) {
      if (rx.test(statement) && !found.has(id)) found.set(id, { id, why });
    }
  }
  return [...found.values()];
}

/** What the author said about it, if anything. */
export function acknowledgement(sql) {
  const match = ACKNOWLEDGEMENT.exec(sql);
  if (!match) return null;
  return { reason: (match[1] ?? "").trim() };
}

/** The gate's verdict for one migration file. */
export function reviewMigration(path, sql) {
  const breaking = findBreakingStatements(sql);
  if (breaking.length === 0) return { path, ok: true, breaking };
  const ack = acknowledgement(sql);
  if (!ack) return { path, ok: false, breaking, reason: null };
  if (!ack.reason) {
    return { path, ok: false, breaking, reason: "", empty: true };
  }
  return { path, ok: true, breaking, reason: ack.reason, acknowledged: true };
}

/**
 * The ref to compare against, or the default branch when it has gone.
 *
 * CI passes the pull request's base branch, and a stacked pull request's base
 * is frequently deleted the moment it merges — at which point `git diff`
 * against a ref that no longer exists throws, and this gate fails a pull
 * request for a reason that has nothing to do with schema compatibility. A
 * tidied-up branch is not a breaking migration, so it must not read like one.
 */
function resolveBase(base) {
  try {
    execFileSync("git", ["rev-parse", "--verify", "--quiet", `${base}^{commit}`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return base;
  } catch {
    const fallback = "origin/main";
    if (base === fallback) throw new Error(`Schema gate: neither ${base} nor a fallback exists.`);
    console.warn(
      `Schema-compatibility gate: "${base}" is gone (a merged base branch, usually), ` +
        `so comparing against ${fallback} instead.`,
    );
    return fallback;
  }
}

function changedMigrations(requested) {
  const base = resolveBase(requested);
  const out = execFileSync(
    "git",
    ["diff", "--name-only", "--diff-filter=AM", `${base}...HEAD`],
    { encoding: "utf8" },
  );
  return out
    .split("\n")
    .filter((f) => /^db\/migrations\/.*\.sql$/.test(f));
}

function main() {
  const base = process.argv[2] ?? "origin/main";
  const files = changedMigrations(base);

  if (files.length === 0) {
    console.log("Schema-compatibility gate: no migrations changed.");
    return;
  }

  const reviews = files.map((f) => reviewMigration(f, readFileSync(f, "utf8")));
  const failures = reviews.filter((r) => !r.ok);

  for (const review of reviews.filter((r) => r.acknowledged)) {
    console.log(
      `Schema-compatibility gate: ${review.path} is declared schema-breaking — ` +
        `"${review.reason}". The release carrying it must be published with ` +
        `schema_breaking: true so the unattended updater refuses it (§39.5).`,
    );
  }

  if (failures.length > 0) {
    console.error(
      "\nSchema-compatibility gate (MASTER.md §39.5): a migration breaks the " +
        "previous release.\n\n" +
        "Rollback is an image swap only while release N's schema is still " +
        "readable by release N-1. Expand, then contract: add the new shape, " +
        "ship code that tolerates both, and drop the old one a release later.\n",
    );
    for (const failure of failures) {
      console.error(`  ${failure.path}`);
      for (const rule of failure.breaking) {
        console.error(`    - ${rule.id}: ${rule.why}`);
      }
      if (failure.empty) {
        console.error(
          "    - the acknowledgement is present but says nothing; write why",
        );
      }
    }
    console.error(
      "\nIf the break is genuinely necessary, say so in the migration:\n" +
        "  -- freeholder:schema-breaking drops contacts.legacy_ref, expanded in 1.4\n" +
        "and publish the release with schema_breaking so it is never applied " +
        "unattended.",
    );
    process.exit(1);
  }

  console.log(
    `Schema-compatibility gate: ${files.length} migration(s) keep the previous release readable.`,
  );
}

// Importable for tests; only the CLI path runs the git plumbing.
if (process.argv[1] && process.argv[1].endsWith("schema-compat-gate.mjs")) {
  main();
}
