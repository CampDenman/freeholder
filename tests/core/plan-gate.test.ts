// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Proof that the single-source planning gate fails for the drift it names.
import { describe, expect, it } from "vitest";
import {
  checklistItems,
  readWorkspaceFiles,
  validatePlan,
} from "../../scripts/plan-gate.mjs";

function master(overrides = ""): string {
  const workstreams = Array.from(
    { length: 12 },
    (_, index) => `- [ ] **C${index}.01** Workstream ${index}`,
  ).join("\n");
  return [
    "# Plan",
    "This is the only product and delivery source of truth.",
    "- [ ] **F01 — Model:** prove it",
    "- [x] **B01 — Baseline:** proved",
    workstreams,
    overrides,
  ].join("\n");
}

function workspace(value = master()): Map<string, string> {
  return new Map([
    ["MASTER.md", value],
    ["CLAUDE.md", "Choose work from MASTER.md §43."],
    ["CONTRIBUTING.md", "Choose work from MASTER.md §43."],
  ]);
}

const codes = (files: Map<string, string>) =>
  validatePlan(files).map(({ code }) => code);

describe("plan consistency", () => {
  it("parses status and stable IDs", () => {
    expect(checklistItems(master()).slice(0, 3)).toEqual([
      { id: "F01", checked: false },
      { id: "B01", checked: true },
      { id: "C0.01", checked: false },
    ]);
  });

  it("refuses duplicate and missing sequence IDs", () => {
    const value = master("- [ ] **C0.01** Duplicate\n- [ ] **C0.03** Gap");
    expect(codes(workspace(value))).toEqual(
      expect.arrayContaining(["duplicate-id", "id-gap"]),
    );
  });

  it("refuses retired planning files and references", () => {
    const files = workspace();
    files.set("ROADMAP.md", "old");
    files.set("notes.md", "See PROJECT_BACKLOG.json");
    expect(codes(files)).toEqual(
      expect.arrayContaining(["retired-file", "retired-reference"]),
    );
  });

  it("refuses references to undefined work", () => {
    const files = workspace();
    files.set("src/example.ts", "// MASTER.md C8.99");
    expect(codes(files)).toContain("unknown-reference");
  });

  it("refuses a missing workstream", () => {
    const value = master().replace("- [ ] **C7.01** Workstream 7\n", "");
    expect(codes(workspace(value))).toContain("missing-workstream");
  });

  it("the current repository passes its own gate", () => {
    expect(validatePlan(readWorkspaceFiles())).toEqual([]);
  });
});
