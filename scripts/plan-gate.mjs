// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The single-source planning gate (MASTER.md §43, C0.08 / C0.12).
//
// Product work used to be split across MASTER.md, ROADMAP.md, and an
// append-only JSON session backlog. That made all three individually plausible
// and collectively untrustworthy. This gate protects the replacement contract:
// one live plan, stable unique IDs, no gaps, no dangling references, checked
// C-items carrying repository evidence, and a current-focus line that still
// names open work.
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
const CHECKLIST_LINE = /^- \[([ x])\] \*\*((F\d{2}|B\d{2}|C\d{1,2}\.\d{2}))(?=\*\*|\s+—)/;
const REFERENCE = /\b(F\d{2}|B\d{2}|C\d{1,2}\.\d{2})\b/g;
const EVIDENCE = /`[^`\n]+`|\bchangeset\b|PR #\d+/i;
const HANDOFF_FILES = ["HANDOFF.md", "RESTART_HANDOFF.md"];
const HANDOFF_HISTORICAL =
  /historical snapshot only|not a planning authority/i;

function issue(code, message, path = "MASTER.md") {
  return { code, path, message };
}

/** Every checklist definition in document order. */
export function checklistItems(master) {
  return checklistBlocks(master).map(({ id, checked }) => ({ id, checked }));
}

/** Title plus following prose, so evidence on wrapped lines is visible. */
export function checklistBlocks(master) {
  const items = [];
  let current;
  for (const line of master.split(/\r?\n/)) {
    const match = line.match(CHECKLIST_LINE);
    if (match) {
      if (current) items.push(current);
      current = { id: match[2], checked: match[1] === "x", body: line };
      continue;
    }
    if (current) current.body += `\n${line}`;
  }
  if (current) items.push(current);
  return items;
}

/**
 * The five proofs a completion claim must name (C0.12).
 *
 * Not all twelve. §43.2's F01–F03, F06, F08, F10 and F11 leave their own
 * artifacts — a migration, a test file, a changeset — that other gates already
 * check. These five are the ones whose absence is invisible: a feature can
 * ship with no human surface, no agent surface, no threat model, no
 * operational story and no cross-module proof, and every other gate in this
 * repository will stay green. C10.01–C10.11 each recorded F04 as "not a new
 * admin screen (C10.11)" and nothing noticed until somebody counted.
 */
const REQUIRED_PROOFS = [
  ["F04", "human surface"],
  ["F05", "agent surface"],
  ["F07", "safety"],
  ["F09", "operations"],
  ["F12", "integration"],
];

/**
 * Items checked before this clause existed, and therefore owed to C11.09.
 *
 * This list is the point, not an escape hatch. Two hundred and seventeen items
 * were checked without naming their human, agent, safety, operational or
 * integration proof; demanding it retroactively in one change would mean
 * writing 217 evidence blocks in a diff nobody could review, and C11.09 is the
 * item that exists to run that matrix properly.
 *
 * So the debt is bounded instead of hidden: nothing new joins this list, and
 * it only ever shrinks. Deleting an entry is how C11.09 records that an item's
 * evidence has actually been written.
 */
const PROOF_DEBT = new Set([
  "C0.01", "C0.02", "C0.03", "C0.04", "C0.05", "C0.06", "C0.07", "C0.08",
  "C0.09", "C0.10", "C1.01", "C1.02", "C1.03", "C1.04", "C1.05", "C1.06",
  "C1.07", "C1.08", "C1.09", "C1.10", "C1.11", "C1.12", "C1.13", "C1.14",
  "C1.15", "C1.16", "C1.17", "C1.18", "C1.19", "C1.20", "C1.21", "C1.22",
  "C1.23", "C1.24", "C1.25", "C1.26", "C1.28", "C1.29", "C1.30", "C1.31",
  "C1.32", "C1.33", "C1.34", "C1.35", "C1.36", "C1.37", "C2.01", "C2.02",
  "C2.03", "C2.04", "C2.05", "C2.06", "C2.07", "C2.08", "C2.09", "C2.10",
  "C2.11", "C2.12", "C2.13", "C2.14", "C2.15", "C2.16", "C2.17", "C2.18",
  "C2.19", "C2.20", "C2.21", "C2.22", "C2.23", "C3.01", "C3.02", "C3.03",
  "C3.04", "C3.05", "C3.06", "C3.07", "C3.08", "C3.09", "C3.10", "C3.11",
  "C3.12", "C3.16", "C3.17", "C3.18", "C3.19", "C3.21", "C3.22", "C3.23",
  "C4.01", "C4.02", "C4.03", "C4.04", "C4.05", "C4.06", "C4.07", "C4.08",
  "C4.09", "C4.10", "C4.11", "C4.12", "C4.13", "C4.14", "C4.15", "C4.16",
  "C4.17", "C4.18", "C4.19", "C4.20", "C4.21", "C4.22", "C4.23", "C5.01",
  "C5.02", "C5.03", "C5.04", "C5.05", "C5.06", "C5.07", "C5.08", "C5.09",
  "C5.10", "C5.11", "C5.12", "C5.13", "C5.14", "C5.15", "C5.16", "C5.17",
  "C5.18", "C5.19", "C5.20", "C5.21", "C5.22", "C5.23", "C5.24", "C6.01",
  "C6.02", "C6.03", "C6.04", "C6.05", "C6.06", "C6.07", "C6.08", "C6.09",
  "C6.10", "C6.11", "C6.12", "C6.13", "C6.14", "C6.15", "C6.16", "C6.17",
  "C7.01", "C7.02", "C7.03", "C7.04", "C7.05", "C7.06", "C7.07", "C7.08",
  "C7.09", "C7.10", "C7.11", "C7.12", "C7.13", "C7.14", "C7.15", "C7.16",
  "C7.17", "C8.01", "C8.02", "C8.03", "C8.04", "C8.05", "C8.06", "C8.07",
  "C8.08", "C8.09", "C8.10", "C8.11", "C8.12", "C8.13", "C9.01", "C9.02",
  "C9.03", "C9.04", "C9.05", "C9.06", "C9.07", "C9.08", "C9.09", "C9.10",
  "C9.11", "C9.12", "C9.13", "C9.14", "C9.15", "C9.16", "C9.17", "C9.18",
  "C9.19", "C9.20", "C9.21", "C9.22", "C9.23", "C9.24", "C9.25", "C9.26",
  "C9.27", "C9.28", "C9.29", "C9.34", "C9.35", "C9.36", "C9.30", "C9.31",
  "C9.32",
]);

/**
 * Every F-code an item's evidence names, including combined declarations.
 *
 * §43 evidence is written for a reader, not a parser: `**F01–F03, F05** N/A —
 * installer CLI` is one clause covering four criteria, and a gate that only
 * understood `**F05**` would demand an item repeat itself to satisfy a regex.
 * Both dash characters appear in the document, so both are ranges.
 */
export function proofsNamed(body) {
  const named = new Set();
  for (const bold of body.matchAll(/\*\*([^*]*F\d{2}[^*]*)\*\*/g)) {
    const clause = bold[1];
    for (const range of clause.matchAll(/F(\d{2})\s*[–—-]\s*F?(\d{2})/g)) {
      for (let n = Number(range[1]); n <= Number(range[2]); n += 1) {
        named.add(`F${String(n).padStart(2, "0")}`);
      }
    }
    for (const single of clause.matchAll(/F(\d{2})/g)) {
      named.add(`F${single[1]}`);
    }
  }
  return named;
}

function proofIssues(blocks) {
  const problems = [];
  for (const { id, checked, body } of blocks) {
    if (!checked || !id.startsWith("C")) continue;
    if (PROOF_DEBT.has(id)) continue;
    const named = proofsNamed(body);
    const missing = REQUIRED_PROOFS.filter(([code]) => !named.has(code));
    if (missing.length > 0) {
      problems.push(
        issue(
          "missing-proof",
          `${id} is checked but its evidence never names ${missing
            .map(([code, what]) => `${code} (${what})`)
            .join(", ")}. Name each, or say N/A and why.`,
        ),
      );
    }
  }
  return problems;
}

/**
 * Paths a checked item cites must exist (C0.12's "resolvable" clause).
 *
 * Only backticked strings that look like repository paths are checked: a
 * segment with a slash and a file extension this repository actually uses.
 * Prose in backticks — a column name, a service name, a flag — is not a path
 * and is not treated as one.
 */
const CITED_PATH = /`([A-Za-z0-9_./-]+\.(?:ts|tsx|mjs|mts|sql|md|json|yaml|yml|sh))`/g;

/**
 * Whether a cited path names a file that exists.
 *
 * Matched by path suffix on a segment boundary, because §43 abbreviates: an
 * item says `webhooks/transport.ts` for `src/core/webhooks/transport.ts`, and
 * insisting on the full path would make the gate a formatting rule rather than
 * a truth check. `contacts/service.ts` matching two files is still a resolved
 * citation — the claim is that the thing exists, not that it is unique.
 */
function resolves(cited, paths) {
  if (paths.has(cited)) return true;
  const suffix = `/${cited}`;
  for (const path of paths) {
    if (path.endsWith(suffix)) return true;
  }
  return false;
}

function resolvableIssues(blocks, paths) {
  const problems = [];
  for (const { id, checked, body } of blocks) {
    if (!checked || !id.startsWith("C")) continue;
    for (const match of body.matchAll(CITED_PATH)) {
      const cited = match[1];
      // A bare filename is a changeset or a doc named in passing; only a path
      // with a directory is a claim about where something lives.
      if (!cited.includes("/")) continue;
      if (!resolves(cited, paths)) {
        problems.push(
          issue(
            "unresolvable-evidence",
            `${id} cites \`${cited}\`, which does not exist. Evidence that cannot be opened is not evidence.`,
          ),
        );
      }
    }
  }
  return problems;
}

/** The control block must describe the plan as it is now (C0.12). */
function controlBlockCurrency(master, today) {
  const problems = [];
  const reconciled = master.match(/\|\s*Last reconciled\s*\|\s*(\d{4}-\d{2}-\d{2})\s*\|/);
  if (!reconciled) {
    problems.push(
      issue(
        "stale-control-block",
        "§43.1's Last reconciled must be an ISO date, so staleness is visible rather than arguable",
      ),
    );
    return problems;
  }
  if (reconciled[1] > today) {
    problems.push(
      issue("stale-control-block", `§43.1 claims it was reconciled on ${reconciled[1]}, which is in the future`),
    );
  }
  return problems;
}

function evidenceIssues(blocks) {
  const problems = [];
  for (const { id, checked, body } of blocks) {
    if (!checked || !id.startsWith("C")) continue;
    if (!EVIDENCE.test(body)) {
      problems.push(
        issue(
          "missing-evidence",
          `${id} is checked but cites no repository evidence (path, changeset, or PR)`,
        ),
      );
    }
  }
  return problems;
}

function controlBlockIssues(master, items) {
  const problems = [];
  if (!/\|\s*Last reconciled\s*\|/.test(master)) {
    problems.push(
      issue("missing-control-block", "§43.1 must include a Last reconciled row"),
    );
  }
  const focus = master.match(/\|\s*Current focus\s*\|\s*([^|\n]+)\|/);
  if (!focus) {
    problems.push(
      issue("missing-control-block", "§43.1 must include a Current focus row"),
    );
    return problems;
  }
  const checked = new Set(
    items.filter((item) => item.checked).map((item) => item.id),
  );
  for (const match of focus[1].matchAll(/\b(C\d{1,2}\.\d{2})\b/g)) {
    if (checked.has(match[1])) {
      problems.push(
        issue(
          "stale-focus",
          `Current focus names ${match[1]}, which is already checked`,
        ),
      );
    }
  }
  return problems;
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
export function validatePlan(files, today = new Date().toISOString().slice(0, 10), paths = null) {
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

  const blocks = checklistBlocks(master);
  const items = blocks.map(({ id, checked }) => ({ id, checked }));
  if (items.length === 0) {
    problems.push(issue("missing-items", "MASTER.md contains no §43 checklist IDs"));
    return problems;
  }
  problems.push(...controlBlockIssues(master, items));
  problems.push(...controlBlockCurrency(master, today));
  problems.push(...evidenceIssues(blocks));
  problems.push(...proofIssues(blocks));
  problems.push(...resolvableIssues(blocks, paths ?? new Set(files.keys())));

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

  for (const path of HANDOFF_FILES) {
    const text = files.get(path);
    if (!text) continue;
    if (!HANDOFF_HISTORICAL.test(text) || !text.includes("MASTER.md")) {
      problems.push(
        issue(
          "stale-handoff",
          `${path} must declare itself historical and defer to MASTER.md §43`,
          path,
        ),
      );
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

/**
 * Every tracked path, not only the text ones.
 *
 * `readWorkspaceFiles` filters to text so the retired-reference scan has
 * something to read. Citation resolution needs the opposite: a `.sh` or a
 * `.sql` is perfectly citable evidence, and checking it against a text-only
 * map reported real files as missing.
 */
export function readTrackedPaths() {
  const tracked = execFileSync("git", ["ls-files"], { encoding: "utf8" });
  const untracked = execFileSync(
    "git",
    ["ls-files", "--others", "--exclude-standard"],
    { encoding: "utf8" },
  );
  return new Set(
    [...tracked.split("\n"), ...untracked.split("\n")]
      .filter(Boolean)
      .filter((path) => !LOCAL_TOOL_STATE.some((prefix) => path.startsWith(prefix))),
  );
}

function main() {
  const files = readWorkspaceFiles();
  const problems = validatePlan(files, undefined, readTrackedPaths());
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
