// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C11.09's durable half: the F01–F12 evidence matrix cannot drift from the
// live plan, cite missing files, or rest on lazy N/A cells.
//
// MASTER.md §43 annotations name each checked item's F04/F05/F07/F09/F12
// proof, and `scripts/plan-gate.mjs` refuses a checked item that names none.
// What no gate protected was the matrix that runs all twelve criteria across
// every row: `deploy/f-criteria-matrix.md`. This script is that protection.
// It parses the matrix and fails on four drifts, each of which has already
// happened at least once in this repository's history:
//
//   1. Row-set drift — a C-item added to or removed from §43 without its
//      matrix row, a deferred §43.18 ID resurrected or dropped, or a
//      package/plugin shipped without a row. The expected set is computed
//      from plan-gate's own parser, never retyped here.
//   2. Empty or missing cells — a row that silently skips a criterion.
//   3. Unresolvable citations — a backticked path that does not exist, or a
//      cited test file that is not part of the actual suite.
//   4. Lazy N/A — "N/A — not applicable" is a shrug, not a reason. An N/A
//      cell must say why the criterion does not apply to this row.
//
// Pure-function design, mirroring plan-gate.mjs: validateMatrix takes text
// and path sets so tests prove every failure with factories, and main()
// wires the real repository into the same call.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { checklistItems, DEFERRED, readTrackedPaths } from "./plan-gate.mjs";

export const MATRIX_DOC = "deploy/f-criteria-matrix.md";
export const CRITERIA = Array.from(
  { length: 12 },
  (_, index) => `F${String(index + 1).padStart(2, "0")}`,
);

const ROW_HEADING = /^## ((?:C\d{1,2}\.\d{2}|packages\/[a-z0-9-]+|plugins\/[a-z0-9-]+)) — (.+)$/;
const CELL_LINE = /^- \*\*(F\d{2})\*\*[ —:](.*)$/;
const BACKTICK = /`([^`\n]+)`/g;
const CITED_PATH =
  /([A-Za-z0-9_./-]+\.(?:ts|tsx|mjs|mts|sql|md|json|yaml|yml|sh|py))/;
const TEST_FILE = /^tests\/(?:core|modules|browser|plugins|helpers|adapters)\/[\w./-]*\.(?:test|spec)\.ts$/;

/** Reasons that are a shrug rather than an explanation. */
const LAZY_NA = [
  /^\s*N\/A\s*[—–-]?\s*(not applicable\.?)?\s*$/i,
  /^\s*N\/A\s*[—–-]\s*(none|no evidence|see above|covered above|obvious|trivial|n\/a)\b/i,
];

function issue(code, message, path = MATRIX_DOC) {
  return { code, path, message };
}

/** Parse the matrix document into rows of criterion cells. */
export function parseMatrix(text) {
  const rows = [];
  const problems = [];
  let current = null;
  for (const line of text.split(/\r?\n/)) {
    const heading = line.match(ROW_HEADING);
    if (heading) {
      if (current) rows.push(current);
      current = { id: heading[1], title: heading[2].trim(), cells: new Map() };
      continue;
    }
    if (!current) continue;
    const cell = line.match(CELL_LINE);
    if (cell) {
      const [, code, body] = cell;
      if (current.cells.has(code)) {
        problems.push(
          issue("duplicate-cell", `${current.id} defines ${code} twice`),
        );
      }
      current.cells.set(code, body.replace(/^[ \-–—:]+/, "").trim());
    }
  }
  if (current) rows.push(current);
  return { rows, problems };
}

/**
 * The row set, computed — never retyped.
 *
 * C-item rows are whatever plan-gate's parser finds in §43 (so a checklist
 * edit either lands its matrix row in the same change or fails here),
 * followed by the §43.18 deferral set in plan-gate's order, then one row per
 * workspace package and first-party plugin directory.
 */
export function expectedRowIds({ masterText, packages, plugins }) {
  const checklist = checklistItems(masterText)
    .map(({ id }) => id)
    .filter((id) => /^C\d{1,2}\.\d{2}$/.test(id));
  return [
    ...checklist,
    ...DEFERRED,
    ...packages.map((name) => `packages/${name}`),
    ...plugins.map((name) => `plugins/${name}`),
  ];
}

/** Whether a cited path names a tracked file (suffix match, as plan-gate). */
function resolves(cited, paths) {
  if (paths.has(cited)) return true;
  const suffix = `/${cited}`;
  for (const path of paths) {
    if (path.endsWith(suffix)) return true;
  }
  return false;
}

/**
 * Validate a workspace represented as text plus path sets.
 *
 * `paths` is every file that may be cited (tracked + visible untracked);
 * `testFiles` is the suite glob — a cited test file must be in it, so a
 * matrix row cannot point at a test that vitest never runs.
 */
export function validateMatrix({
  matrixText,
  masterText,
  paths,
  testFiles,
  packages,
  plugins,
}) {
  const problems = [];
  const { rows, problems: parseProblems } = parseMatrix(matrixText);
  problems.push(...parseProblems);

  const expected = expectedRowIds({ masterText, packages, plugins });
  const actual = rows.map(({ id }) => id);
  const expectedSet = new Set(expected);
  const actualSet = new Set(actual);
  for (const id of expected) {
    if (!actualSet.has(id)) {
      problems.push(
        issue("missing-row", `${id} is in the live plan (or the deferral set, or ships as a package/plugin) but has no matrix row`),
      );
    }
  }
  for (const id of actual) {
    if (!expectedSet.has(id)) {
      problems.push(
        issue("extra-row", `${id} has a matrix row but is not a live C-item, a §43.18 deferral, or a package/plugin — the matrix drifted from the plan`),
      );
    }
  }
  const orderExpected = expected.filter((id) => actualSet.has(id));
  if (orderExpected.join("\n") !== actual.join("\n")) {
    problems.push(
      issue(
        "row-order",
        `matrix rows must follow the plan's document order, then deferrals, then packages, then plugins; first mismatch: ${firstMismatch(orderExpected, actual)}`,
      ),
    );
  }

  for (const row of rows) {
    for (const code of CRITERIA) {
      const cell = row.cells.get(code);
      if (cell === undefined) {
        problems.push(
          issue("missing-cell", `${row.id} names no ${code} cell — every criterion is audited, none skipped`),
        );
        continue;
      }
      if (cell.length === 0) {
        problems.push(issue("empty-cell", `${row.id}'s ${code} cell is empty`));
        continue;
      }
      problems.push(...cellProblems(row.id, code, cell, paths, testFiles));
    }
  }
  return problems;
}

function firstMismatch(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    if (a[i] !== b[i]) return `position ${i + 1}: expected ${a[i] ?? "—"}, found ${b[i] ?? "—"}`;
  }
  return "unknown";
}

function cellProblems(rowId, code, cell, paths, testFiles) {
  const problems = [];
  const cited = [...cell.matchAll(BACKTICK)].map((match) => match[1]);
  const pathCitations = cited.filter((span) =>
    CITED_PATH.test(span) && span.includes("/"),
  );
  const isNA = /^N\/A\b/.test(cell);

  if (isNA) {
    for (const lazy of LAZY_NA) {
      if (lazy.test(cell)) {
        problems.push(
          issue(
            "lazy-na",
            `${rowId}'s ${code} cell says "${cell.slice(0, 60)}" — an N/A cell must name the specific reason the criterion does not apply`,
          ),
        );
        return problems;
      }
    }
    if (!/[—–]/.test(cell)) {
      problems.push(
        issue("lazy-na", `${rowId}'s ${code} cell is N/A without a reason after the dash`),
      );
    }
    // Citations inside an N/A cell are still checked: a reason that cites a
    // file cites a file that must exist.
  }

  if (!isNA && pathCitations.length === 0) {
    problems.push(
      issue(
        "evidenceless-cell",
        `${rowId}'s ${code} cell cites no repository path and is not an N/A — evidence is a path that resolves, or an explicit reason`,
      ),
    );
  }

  for (const span of cited) {
    if (!CITED_PATH.test(span)) continue; // prose in backticks: flags, routes
    if (!span.includes("/")) continue; // bare names: changesets, historical tags
    if (!resolves(span, paths)) {
      problems.push(
        issue(
          "unresolvable-citation",
          `${rowId}'s ${code} cell cites \`${span}\`, which does not exist in the repository`,
        ),
      );
    }
    if (TEST_FILE.test(span) && !testFiles.has(span)) {
      problems.push(
        issue(
          "uncited-test",
          `${rowId}'s ${code} cell cites \`${span}\`, which is not part of the test suite (no such file under tests/)`,
        ),
      );
    }
  }
  return problems;
}

/** Every test file the suite can run, relative to the repository root. */
export function readTestFiles(root = ".") {
  const files = new Set();
  const walk = (dir) => {
    for (const entry of readdirSync(join(root, dir))) {
      const path = `${dir}/${entry}`;
      const stat = statSync(join(root, path));
      if (stat.isDirectory()) walk(path);
      else if (/\.(?:test|spec)\.ts$/.test(entry)) files.add(path);
    }
  };
  walk("tests");
  return files;
}

function main() {
  const masterText = readFileSync("MASTER.md", "utf8");
  const matrixText = readFileSync(MATRIX_DOC, "utf8");
  const packages = readdirSync("packages", { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const plugins = readdirSync("plugins", { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const problems = validateMatrix({
    matrixText,
    masterText,
    paths: readTrackedPaths(),
    testFiles: readTestFiles(),
    packages,
    plugins,
  });
  if (problems.length > 0) {
    console.error(
      "F-criteria matrix (C11.09): evidence matrix drifted.\n\n" +
        problems
          .map(({ code, path, message }) => `  ${path}: [${code}] ${message}`)
          .join("\n"),
    );
    process.exit(1);
  }
  const { rows } = parseMatrix(matrixText);
  console.log(
    `F-criteria matrix: ${rows.length} rows × ${CRITERIA.length} criteria; ` +
      `row set matches the live plan, every cell carries evidence or a reason.`,
  );
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main();
}
