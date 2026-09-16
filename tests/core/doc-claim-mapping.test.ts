// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C11.15: every affirmative §§1–42 documentation claim is mapped to passing
// acceptance evidence, or struck in the same change. This gate fails closed:
// an unmapped section, an unresolved evidence path, a claim row without a
// test/gate citation, or a strike whose old wording still parses in MASTER.md
// all fail here — an unchecked map is how a doc-claim item rots.
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const doc = readFileSync("deploy/doc-claim-mapping.md", "utf8");
const master = readFileSync("MASTER.md", "utf8");

interface ClaimRow {
  section: string;
  disposition: string;
  evidence: string;
}

/** Claim-map table rows: | § | Claim | Disposition | Evidence | */
function claimRows(): ClaimRow[] {
  const rows: ClaimRow[] = [];
  for (const line of doc.split("\n")) {
    const match = line.match(/^\|\s*(\d{1,2}(?:\.\d{1,2})?)\s*\|/);
    if (!match || match[1] === undefined) continue;
    const cells = line.split("|").map((cell) => cell.trim());
    const section = cells[1];
    const disposition = cells[3];
    const evidence = cells[4];
    if (section === undefined || disposition === undefined || evidence === undefined) {
      continue;
    }
    rows.push({ section, disposition, evidence });
  }
  return rows;
}

interface Strike {
  id: string;
  pairs: { old: string; new: string }[];
}

/** Strike entries: `### S<n> — …` blocks with `- Old:` / `- New:` lines. */
function strikes(): Strike[] {
  const result: Strike[] = [];
  let current: Strike | null = null;
  let pendingOld: string | null = null;
  for (const line of doc.split("\n")) {
    const head = line.match(/^### (S\d+) — /);
    if (head && head[1] !== undefined) {
      current = { id: head[1], pairs: [] };
      result.push(current);
      pendingOld = null;
      continue;
    }
    if (!current) continue;
    const old = line.match(/^- Old: (.+)$/);
    if (old && old[1] !== undefined) {
      pendingOld = old[1];
      continue;
    }
    const next = line.match(/^- New: (.+)$/);
    if (next && next[1] !== undefined && pendingOld !== null) {
      current.pairs.push({ old: pendingOld, new: next[1] });
      pendingOld = null;
    }
  }
  return result;
}

const ACCEPTANCE_CITATION =
  /\.test\.ts$|\.spec\.ts$|^scripts\/|\.mjs$|\.sh$/;

describe("C11.15 doc-claim mapping", () => {
  const rows = claimRows();

  it("maps every section in §§1–42 — no skips", () => {
    const sections = new Set(rows.map((row) => row.section));
    for (let n = 1; n <= 42; n += 1) {
      if (n === 4) {
        for (let m = 1; m <= 17; m += 1) {
          expect(sections.has(`4.${m}`), `§4.${m} has no claim row`).toBe(true);
        }
        continue;
      }
      expect(sections.has(String(n)), `§${n} has no claim row`).toBe(true);
    }
  });

  it("gives every claim row a valid disposition and an evidence-or-strike", () => {
    expect(rows.length).toBeGreaterThan(100);
    for (const row of rows) {
      expect(
        ["Evidence", "Narrowed", "Struck"],
        `§${row.section} disposition "${row.disposition}"`,
      ).toContain(row.disposition);
      expect(row.evidence.length, `§${row.section} empty evidence`).toBeGreaterThan(0);
      if (row.disposition === "Evidence") {
        const cited = [...row.evidence.matchAll(/`([^`]+)`/g)]
          .map((m) => m[1])
          .filter((path): path is string => path !== undefined);
        expect(
          cited.some((path) => ACCEPTANCE_CITATION.test(path)),
          `§${row.section} cites no test suite or gate: ${row.evidence}`,
        ).toBe(true);
      } else {
        expect(row.evidence, `§${row.section} must name its strike entry`).toMatch(/^S\d+$/);
      }
    }
  });

  it("resolves every cited evidence path in the tree", () => {
    const unresolved: string[] = [];
    for (const row of rows) {
      if (row.disposition !== "Evidence") continue;
      for (const match of row.evidence.matchAll(/`([^`]+)`/g)) {
        const cited = match[1];
        if (cited === undefined) continue;
        if (!cited.includes("/") && !cited.startsWith(".")) continue;
        if (!existsSync(cited)) unresolved.push(`§${row.section}: ${cited}`);
      }
    }
    expect(unresolved, `unresolved evidence paths:\n${unresolved.join("\n")}`).toEqual([]);
  });

  it("verifies every Struck/Narrowed row against the actual MASTER.md diff", () => {
    const list = strikes();
    expect(list.length).toBeGreaterThanOrEqual(10);
    // Strike ids are contiguous from S1 so one cannot be silently dropped.
    list.forEach((strike, index) => {
      expect(strike.id).toBe(`S${index + 1}`);
    });
    const byId = new Map(list.map((strike) => [strike.id, strike]));
    for (const row of rows) {
      if (row.disposition === "Evidence") continue;
      const strike = byId.get(row.evidence);
      expect(strike, `§${row.section} names unknown strike ${row.evidence}`).toBeDefined();
    }
    for (const strike of list) {
      expect(strike.pairs.length, `${strike.id} has no Old/New pair`).toBeGreaterThan(0);
      for (const pair of strike.pairs) {
        expect(
          master.includes(pair.old),
          `${strike.id} old wording must be gone from MASTER.md:\n${pair.old}`,
        ).toBe(false);
        expect(
          master.includes(pair.new),
          `${strike.id} new wording must appear in MASTER.md:\n${pair.new}`,
        ).toBe(true);
      }
    }
  });

  it("declares the map complete, with counts that match the table", () => {
    expect(doc).toMatch(/\*\*Status: COMPLETE\.\*\*/);
    const evidence = rows.filter((row) => row.disposition === "Evidence").length;
    const struck = rows.length - evidence;
    // The counts are stated in MASTER.md's C11.15 annotation; reflow makes
    // line breaks arbitrary, so compare against whitespace-normalized text.
    const annotation = master
      .replace(/\s+/g, " ")
      .match(/(\d+) rows carry test\/gate evidence; (\d+) rows are Struck\/Narrowed/i);
    expect(annotation, "MASTER.md C11.15 annotation must state the counts").not.toBeNull();
    expect(Number(annotation![1])).toBe(evidence);
    expect(Number(annotation![2])).toBe(struck);
  });
});
