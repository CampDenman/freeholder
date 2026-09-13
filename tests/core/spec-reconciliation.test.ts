// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C11.16: the recon table names every MASTER.md section and keeps leftover
// affirmative work on an open checklist item (or the spec was struck).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checklistItems } from "../../scripts/plan-gate.mjs";

const recon = readFileSync("deploy/spec-reconciliation.md", "utf8");
const master = readFileSync("MASTER.md", "utf8");

describe("C11.16 spec reconciliation", () => {
  it("tables every section in §§1–42", () => {
    for (let n = 1; n <= 42; n += 1) {
      if (n === 4) {
        expect(recon).toMatch(/\| 4\.1 \|/);
        expect(recon).toMatch(/\| 4\.17 \|/);
        continue;
      }
      expect(recon).toMatch(new RegExp(`\\| ${n} \\|`));
    }
  });

  it("is checked only with remaining work named against open C-items", () => {
    const items = new Map(
      checklistItems(master).map((item) => [item.id, item.checked]),
    );
    expect(items.get("C11.16")).toBe(true);
    expect(items.get("C11.17")).toBe(false);
    for (const id of [
      "C0.11",
      "C10.16",
      "C11.08",
      "C11.09",
      "C11.10",
      "C11.11",
      "C11.12",
      "C11.14",
      "C11.15",
      "C11.17",
    ]) {
      expect(items.get(id)).toBe(false);
      expect(recon).toContain(id);
    }
  });

  it("does not claim DONE and leaves the owner signature blank", () => {
    expect(recon).toMatch(/does not claim DONE/i);
    expect(master).toMatch(/\|\s*Owner signature\s*\|\s*_unsigned/i);
    expect(master).toMatch(/C11\.17 — DONE[\s\S]*?\*\*Not signed\. Not checked\.\*\*/);
  });
});
