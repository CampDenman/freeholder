// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C11.09: the F01–F12 evidence matrix fails on the drift it exists to catch.
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CRITERIA,
  expectedRowIds,
  parseMatrix,
  readTestFiles,
  validateMatrix,
} from "../../scripts/f-matrix.mjs";
import { checklistItems, DEFERRED, readTrackedPaths } from "../../scripts/plan-gate.mjs";

const CODES = CRITERIA;

function master(): string {
  const workstreams = Array.from(
    { length: 12 },
    (_, index) => `- [ ] **C${index}.01** Workstream ${index}`,
  ).join("\n");
  return [
    "# Plan",
    "This is the only product and delivery source of truth.",
    "| Last reconciled | 2026-09-16 |",
    "| Current focus | C0.01 |",
    workstreams,
  ].join("\n");
}

const PACKAGES = ["sdk", "create-freeholder"];
const PLUGINS = ["community"];

/** A full-width matrix: every expected row, every cell filled. */
function matrix(overrides: Record<string, Record<string, string>> = {}): string {
  const ids = expectedRowIds({
    masterText: master(),
    packages: PACKAGES,
    plugins: PLUGINS,
  });
  return ids
    .map((id) => {
      const cells = CODES.map((code) => {
        const body =
          overrides[id]?.[code] ??
          (code === "F04"
            ? "N/A — no human surface in this item"
            : "`src/core/thing.ts` proves it");
        return `- **${code}** — ${body}`;
      }).join("\n");
      return `## ${id} — Row\n\n${cells}`;
    })
    .join("\n\n");
}

const PATHS = new Set(["src/core/thing.ts", "tests/core/thing.test.ts"]);
const TESTFILES = new Set(["tests/core/thing.test.ts"]);

function validate(matrixText: string, masterText = master()) {
  return validateMatrix({
    matrixText,
    masterText,
    paths: PATHS,
    testFiles: TESTFILES,
    packages: PACKAGES,
    plugins: PLUGINS,
  });
}

const codes = (problems: { code: string }[]) => problems.map((p) => p.code);

describe("F-criteria matrix (C11.09)", () => {
  it("computes the row set from plan-gate's parser plus deferrals, packages and plugins", () => {
    const ids = expectedRowIds({
      masterText: master(),
      packages: PACKAGES,
      plugins: PLUGINS,
    });
    const checklist = checklistItems(master()).map(({ id }) => id);
    expect(ids.slice(0, 12)).toEqual(checklist);
    expect(ids.slice(12, 19)).toEqual([...DEFERRED]);
    expect(ids.slice(19)).toEqual([
      "packages/sdk",
      "packages/create-freeholder",
      "plugins/community",
    ]);
  });

  it("accepts a complete matrix", () => {
    expect(validate(matrix())).toEqual([]);
  });

  it("refuses a live C-item with no row", () => {
    const lines = matrix().split("\n");
    const without = lines.filter((line) => !line.startsWith("## C3.01 ")).join("\n");
    expect(codes(validate(without))).toContain("missing-row");
  });

  it("refuses a deferred §43.18 ID losing its row", () => {
    const lines = matrix().split("\n");
    const without = lines.filter((line) => !line.startsWith("## C10.17 ")).join("\n");
    expect(codes(validate(without))).toContain("missing-row");
  });

  it("refuses a package or plugin shipping without a row", () => {
    const lines = matrix().split("\n");
    const without = lines.filter((line) => !line.startsWith("## plugins/community ")).join("\n");
    expect(codes(validate(without))).toContain("missing-row");
  });

  it("refuses a row the plan does not define", () => {
    // Assembled at runtime: a literal undefined ID in this file would itself
    // trip plan-gate's workspace reference scan.
    const invented = ["C9", "99"].join(".");
    const block = `## ${invented} — Invented\n\n${CODES.map((c) => `- **${c}** — \`src/core/thing.ts\``).join("\n")}`;
    expect(codes(validate(matrix() + `\n${block}`))).toContain("extra-row");
  });

  it("refuses rows out of plan document order", () => {
    const text = matrix();
    const a = "## C1.01 — Row";
    const b = "## C2.01 — Row";
    const swapped = text.replace(a, "@@").replace(b, a).replace("@@", b);
    expect(codes(validate(swapped))).toContain("row-order");
  });

  it("refuses a row that skips a criterion", () => {
    const lines = matrix().split("\n").filter((line) => !line.startsWith("- **F07**"));
    expect(codes(validate(lines.join("\n")))).toContain("missing-cell");
  });

  it("refuses an empty cell", () => {
    expect(
      codes(validate(matrix({ "C0.01": { F02: "" } }))),
    ).toContain("empty-cell");
  });

  it("refuses a cell that is neither evidence nor N/A", () => {
    expect(
      codes(validate(matrix({ "C0.01": { F02: "it works, trust me" } }))),
    ).toContain("evidenceless-cell");
  });

  it("refuses a citation that does not exist", () => {
    expect(
      codes(validate(matrix({ "C0.01": { F02: "`src/core/invented.ts` proves it" } }))),
    ).toContain("unresolvable-citation");
  });

  it("refuses a cited test file that is not part of the suite", () => {
    expect(
      codes(validate(matrix({ "C0.01": { F08: "`tests/core/never-collected.test.ts` proves it" } }))),
    ).toContain("uncited-test");
  });

  it("accepts a cited test file the suite actually runs", () => {
    expect(
      codes(validate(matrix({ "C0.01": { F08: "`tests/core/thing.test.ts` proves it" } }))),
    ).not.toContain("uncited-test");
  });

  it("refuses a lazy N/A", () => {
    expect(codes(validate(matrix({ "C0.01": { F04: "N/A — not applicable" } })))).toContain("lazy-na");
    expect(codes(validate(matrix({ "C0.01": { F04: "N/A" } })))).toContain("lazy-na");
  });

  it("still checks citations inside an N/A cell", () => {
    expect(
      codes(
        validate(matrix({ "C0.01": { F04: "N/A — no screen; see `src/core/invented.ts`" } })),
      ),
    ).toContain("unresolvable-citation");
  });

  it("parses rows and cells", () => {
    const { rows, problems } = parseMatrix(matrix());
    expect(problems).toEqual([]);
    expect(rows).toHaveLength(12 + DEFERRED.size + PACKAGES.length + PLUGINS.length);
    expect(rows[0]!.id).toBe("C0.01");
    expect(rows[0]!.cells.get("F01")).toBe("`src/core/thing.ts` proves it");
  });

  it("the real repository's matrix matches the live plan and resolves every citation", () => {
    // Same call the CLI makes: the real MASTER.md, the real matrix doc, every
    // tracked path, and the real suite glob so a cited test must be one
    // vitest actually runs.
    const packages = readdirSync("packages", { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    const plugins = readdirSync("plugins", { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    expect(
      validateMatrix({
        matrixText: readFileSync("deploy/f-criteria-matrix.md", "utf8"),
        masterText: readFileSync("MASTER.md", "utf8"),
        paths: readTrackedPaths(),
        testFiles: readTestFiles(),
        packages,
        plugins,
      }),
    ).toEqual([]);
  });
});
