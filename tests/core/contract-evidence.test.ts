// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { missingContractEvidence } from "../../scripts/contract-evidence.mjs";

describe("fast gate execution evidence (C11.15)", () => {
  const file = "tests/core/example.test.ts";
  const report = (statuses: string[]) => ({
    testResults: [{ name: resolve(file), assertionResults: statuses.map((status) => ({ status })) }],
  });

  it("rejects missing, empty, and entirely skipped required files", () => {
    for (const result of [{}, report([]), report(["pending", "todo", "skipped"])]) {
      expect(missingContractEvidence([file], result)).toEqual([file]);
    }
  });

  it("requires evidence for every file, even if another file passed", () => {
    expect(missingContractEvidence([file, "tests/core/absent.test.ts"], report(["passed"])))
      .toEqual(["tests/core/absent.test.ts"]);
  });

  it("accepts executed static tests in a file with optional database tests", () => {
    expect(missingContractEvidence([file], report(["passed", "pending"]))).toEqual([]);
  });

  it("does not count failed tests as passing evidence", () => {
    expect(missingContractEvidence([file], report(["failed"]))).toEqual([file]);
  });
});
