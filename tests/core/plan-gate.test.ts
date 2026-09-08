// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Proof that the single-source planning gate fails for the drift it names.
import { describe, expect, it } from "vitest";
import {
  checklistItems,
  proofsNamed,
  readTrackedPaths,
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
    "| Last reconciled | 2026-09-06 |",
    "| Current focus | C0.01 |",
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
    // Same call the CLI makes: citation resolution needs every tracked path,
    // not only the text files the retired-reference scan reads. A `.sh` or a
    // `.sql` is perfectly citable evidence.
    expect(validatePlan(readWorkspaceFiles(), undefined, readTrackedPaths())).toEqual([]);
  });

  it("refuses a checked C-item that cites no repository evidence", () => {
    const value = master("- [x] **C0.02** Done with no proof");
    expect(codes(workspace(value))).toContain("missing-evidence");
  });

  it("refuses current focus that names a checked item", () => {
    const value = master("- [x] **C0.02** Done (`src/core/service.ts`)").replace(
      "| Current focus | C0.01 |",
      "| Current focus | C0.02 |",
    );
    expect(codes(workspace(value))).toContain("stale-focus");
  });

  it("refuses a handoff file that still claims to be current", () => {
    const files = workspace();
    files.set(
      "RESTART_HANDOFF.md",
      "This is the current session handoff for the next sprint.",
    );
    expect(codes(files)).toContain("stale-handoff");
  });
});

describe("completion evidence has to name its proofs (C0.12)", () => {
  const codes = (problems: { code: string }[]) => problems.map((p) => p.code);

  const proved = [
    "**F04** admin screen. **F05** `thing.do`. **F07** anonymous refused.",
    "**F09** retryable job. **F12** end-to-end journey.",
  ].join(" ");

  it("refuses a newly checked item that names none of them", () => {
    // The failure this exists for: C10.01–C10.11 each recorded F04 as "not a
    // new admin screen (C10.11)", eleven items deferred their human surface to
    // one line, and every other gate stayed green.
    const problems = validatePlan(
      workspace(master("- [x] **C11.01** Done *(`src/core/thing.ts`.)*")),
    );
    expect(codes(problems)).toContain("missing-proof");
    expect(problems.find((p) => p.code === "missing-proof")?.message).toContain("F04");
  });

  it("accepts an item that names all five", () => {
    const problems = validatePlan(
      workspace(master(`- [x] **C11.01** Done *(\`src/core/thing.ts\`. ${proved})*`)),
    );
    expect(codes(problems)).not.toContain("missing-proof");
  });

  it("accepts a combined declaration, because evidence is written for readers", () => {
    // `**F01–F03, F05** N/A — installer CLI` is one clause covering four
    // criteria. A gate that only understood `**F05**` would make an item
    // repeat itself to satisfy a regex.
    expect([...proofsNamed("**F01–F03, F05** N/A")].sort()).toEqual([
      "F01",
      "F02",
      "F03",
      "F05",
    ]);
    expect(proofsNamed("**F04** yes").has("F04")).toBe(true);
    expect(proofsNamed("F04 outside bold").has("F04")).toBe(false);
  });

  it("says nothing about an item that is still open", () => {
    const problems = validatePlan(workspace(master("- [ ] **C11.01** Not done yet")));
    expect(codes(problems)).not.toContain("missing-proof");
  });
});

describe("cited evidence has to be openable (C0.12)", () => {
  it("refuses a path that does not exist", () => {
    const problems = validatePlan(
      workspace(
        master("- [x] **C11.01** Done *(`src/core/invented.ts`. **F04** a. **F05** b. **F07** c. **F09** d. **F12** e.)*"),
      ),
    );
    expect(problems.map((p) => p.code)).toContain("unresolvable-evidence");
  });

  it("resolves an abbreviated path, because §43 writes them short", () => {
    // An item says `webhooks/transport.ts` for `src/core/webhooks/transport.ts`.
    // Insisting on the full path would make this a formatting rule rather than
    // a truth check.
    const problems = validatePlan(
      workspace(
        master("- [x] **C11.01** Done *(`core/thing.ts`. **F04** a. **F05** b. **F07** c. **F09** d. **F12** e.)*"),
      ),
      "2026-09-08",
      new Set(["MASTER.md", "src/core/thing.ts"]),
    );
    expect(problems.map((p) => p.code)).not.toContain("unresolvable-evidence");
  });

  it("leaves prose in backticks alone", () => {
    // A column name, a service name or a flag is not a path.
    const problems = validatePlan(
      workspace(
        master("- [x] **C11.01** Done *(`contact_id`, `platform.doThing`, `--flag`. **F04** a. **F05** b. **F07** c. **F09** d. **F12** e.)*"),
      ),
    );
    expect(problems.map((p) => p.code)).not.toContain("unresolvable-evidence");
  });
});

describe("the control block has to be current (C0.12)", () => {
  it("refuses a reconciled date in the future", () => {
    const problems = validatePlan(workspace(master()), "2026-09-05");
    expect(problems.map((p) => p.code)).toContain("stale-control-block");
  });

  it("accepts a date that has already happened", () => {
    const problems = validatePlan(workspace(master()), "2026-09-08");
    expect(problems.map((p) => p.code)).not.toContain("stale-control-block");
  });

  it("refuses a control block with no date at all", () => {
    const withoutDate = master().replace("| Last reconciled | 2026-09-06 |", "| Last reconciled | soon |");
    const problems = validatePlan(workspace(withoutDate), "2026-09-08");
    expect(problems.map((p) => p.code)).toContain("stale-control-block");
  });
});
