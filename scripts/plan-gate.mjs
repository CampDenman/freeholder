// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The single-source planning gate (MASTER.md §43, C0.08).
//
// Product work used to be split across MASTER.md, ROADMAP.md, and an
// append-only JSON session backlog. That made all three individually plausible
// and collectively untrustworthy. This gate protects the replacement contract:
// one live plan, stable unique IDs, no gaps, and no dangling references.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const RETIRED = ["ROADMAP.md", "PROJECT_BACKLOG.json"];
const RETIRED_REFERENCE_ALLOW = new Set([
  "MASTER.md",
  "scripts/plan-gate.mjs",
  "tests/core/plan-gate.test.ts",
]);
const REFERENCE_ALLOW = new Set(["tests/core/plan-gate.test.ts"]);
const REQUIRED_WORKSTREAMS = Array.from({ length: 12 }, (_, i) => `C${i}`);
const TEXT_FILE = /(?:\.md|\.json|\.ts|\.tsx|\.js|\.mjs|\.mts|\.yml|\.yaml|\.txt)$/i;
const LOCAL_TOOL_STATE = [".agents/", ".claude/", ".codex/"];
const CHECKLIST = /^- \[([ x])\] \*\*((F\d{2}|B\d{2}|C\d{1,2}\.\d{2}))(?=\*\*|\s+—)/gm;
const REFERENCE = /\b(F\d{2}|B\d{2}|C\d{1,2}\.\d{2})\b/g;

function issue(code, message, path = "MASTER.md") {
  return { code, path, message };
}

/** Every checklist definition in document order. */
export function checklistItems(master) {
  return [...master.matchAll(CHECKLIST)].map((match) => ({
    id: match[2],
    checked: match[1] === "x",
  }));
}

/** A missing number is usually a deleted work item whose obligation vanished. */
function sequenceIssues(items) {
  const problems = [];
  const groups = new Map();
  for (const { id } of items) {
    const match = /^(F|B|C\d+)\.?(\d+)$/.exec(id);
    if (!match) continue;
    const values = groups.get(match[1]) ?? [];
    values.push(Number(match[2]));
    groups.set(match[1], values);
  }

  for (const [group, values] of groups) {
    const ordered = [...new Set(values)].sort((a, b) => a - b);
    const expected = Array.from(
      { length: ordered.at(-1) ?? 0 },
      (_, index) => index + 1,
    );
    if (ordered.join(",") !== expected.join(",")) {
      problems.push(
        issue(
          "id-gap",
          `${group} must be contiguous from 01; found ${ordered.map((n) => String(n).padStart(2, "0")).join(", ")}`,
        ),
      );
    }
  }
  return problems;
}

/**
 * Validate a workspace represented as path → text.
 *
 * Keeping this pure is what lets the tests prove the gate can fail without
 * creating and deleting files in the real worktree.
 */
export function validatePlan(files) {
  const problems = [];
  const master = files.get("MASTER.md");
  if (!master) return [issue("missing-master", "MASTER.md does not exist")];

  if (!master.includes("only product and delivery source of truth")) {
    problems.push(
      issue(
        "missing-contract",
        "MASTER.md must state that it is the only product and delivery source of truth",
      ),
    );
  }

  for (const path of RETIRED) {
    if (files.has(path)) {
      problems.push(issue("retired-file", `${path} was retired by C0.02`, path));
    }
  }

  for (const [path, text] of files) {
    if (RETIRED_REFERENCE_ALLOW.has(path)) continue;
    for (const retired of RETIRED) {
      if (text.includes(retired)) {
        problems.push(
          issue(
            "retired-reference",
            `${path} points at retired planning file ${retired}`,
            path,
          ),
        );
      }
    }
  }

  const items = checklistItems(master);
  if (items.length === 0) {
    problems.push(issue("missing-items", "MASTER.md contains no §43 checklist IDs"));
    return problems;
  }

  const counts = new Map();
  for (const { id } of items) counts.set(id, (counts.get(id) ?? 0) + 1);
  for (const [id, count] of counts) {
    if (count > 1) {
      problems.push(issue("duplicate-id", `${id} is defined ${count} times`));
    }
  }
  problems.push(...sequenceIssues(items));

  const defined = new Set(items.map(({ id }) => id));
  for (const workstream of REQUIRED_WORKSTREAMS) {
    if (![...defined].some((id) => id.startsWith(`${workstream}.`))) {
      problems.push(
        issue("missing-workstream", `${workstream} has no checklist items`),
      );
    }
  }

  for (const [path, text] of files) {
    if (REFERENCE_ALLOW.has(path)) continue;
    for (const match of text.matchAll(REFERENCE)) {
      if (!defined.has(match[1])) {
        problems.push(
          issue(
            "unknown-reference",
            `${path} references undefined checklist ID ${match[1]}`,
            path,
          ),
        );
      }
    }
  }

  for (const path of ["CLAUDE.md", "CONTRIBUTING.md"]) {
    const text = files.get(path) ?? "";
    if (!text.includes("MASTER.md") || !text.includes("§43")) {
      problems.push(
        issue(
          "missing-contributor-contract",
          `${path} must direct work to MASTER.md §43`,
          path,
        ),
      );
    }
  }

  return problems;
}

/** Read tracked plus visible untracked text files for the CLI gate. */
export function readWorkspaceFiles() {
  const tracked = execFileSync("git", ["ls-files"], { encoding: "utf8" });
  const untracked = execFileSync(
    "git",
    ["ls-files", "--others", "--exclude-standard"],
    { encoding: "utf8" },
  );
  const paths = [...new Set([...tracked.split("\n"), ...untracked.split("\n")])]
    .filter(Boolean)
    .filter((path) => !LOCAL_TOOL_STATE.some((prefix) => path.startsWith(prefix)))
    .filter((path) => TEXT_FILE.test(path))
    .filter((path) => existsSync(path));
  return new Map(paths.map((path) => [path, readFileSync(path, "utf8")]));
}

function main() {
  const files = readWorkspaceFiles();
  const problems = validatePlan(files);
  if (problems.length > 0) {
    console.error(
      "Plan consistency (MASTER.md §43): the single source of truth drifted.\n\n" +
        problems
          .map(({ code, path, message }) => `  ${path}: [${code}] ${message}`)
          .join("\n"),
    );
    process.exit(1);
  }

  const items = checklistItems(files.get("MASTER.md"));
  const complete = items.filter(({ checked }) => checked).length;
  console.log(
    `Plan consistency: ${items.length} unique IDs, ${complete} checked, ` +
      `${items.length - complete} open; one source of truth.`,
  );
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main();
}
