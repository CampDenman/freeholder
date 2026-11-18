// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The customer-app audit allowance policy (C1.20, §36).
import { describe, expect, it } from "vitest";
// @ts-expect-error -- plain ESM gate script, no type declarations
import { evaluateMobileAudit } from "../../scripts/mobile-audit.mjs";

const NOW = new Date("2026-11-18T00:00:00Z");

function report(...advisories: Array<{ ghsa: string; name: string; severity?: string }>) {
  return {
    vulnerabilities: Object.fromEntries(advisories.map((a, index) => [
      `package-${index}`,
      {
        severity: a.severity ?? "high",
        // A string `via` is a cascade entry, not a root advisory. Including one
        // proves the evaluator does not mistake it for an unnamed GHSA.
        via: ["some-other-package", {
          url: `https://github.com/advisories/${a.ghsa}`,
          name: a.name,
          severity: a.severity ?? "high",
          title: `${a.name} is vulnerable`,
        }],
      },
    ])),
    metadata: { vulnerabilities: { critical: 0, high: advisories.length, moderate: 0 } },
  };
}

const allowance = (over: Record<string, unknown> = {}) => new Map([
  ["GHSA-aaaa-bbbb-cccc", {
    package: "picomatch", reviewedAt: "2026-11-18", expiresAt: "2027-02-16",
    reason: "no patch exists", ...over,
  }],
]);

describe("customer app audit allowances", () => {
  it("passes when every root advisory is named", () => {
    const { errors, found } = evaluateMobileAudit(
      report({ ghsa: "GHSA-aaaa-bbbb-cccc", name: "picomatch" }), allowance(), NOW);
    expect(errors).toEqual([]);
    expect(found.size).toBe(1);
  });

  it("fails on any advisory that is not named, which is the whole point", () => {
    const { errors } = evaluateMobileAudit(
      report({ ghsa: "GHSA-aaaa-bbbb-cccc", name: "picomatch" },
             { ghsa: "GHSA-dddd-eeee-ffff", name: "something-else" }), allowance(), NOW);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("GHSA-dddd-eeee-ffff");
    expect(errors[0]).toContain("is not allowed");
  });

  it("fails an expired allowance rather than inheriting it", () => {
    const { errors } = evaluateMobileAudit(
      report({ ghsa: "GHSA-aaaa-bbbb-cccc", name: "picomatch" }),
      allowance({ reviewedAt: "2026-01-01", expiresAt: "2026-04-01" }), NOW);
    expect(errors.some((e: string) => e.includes("expired on 2026-04-01"))).toBe(true);
  });

  it("refuses an allowance that outlives the 90-day maximum", () => {
    const { errors } = evaluateMobileAudit(
      report({ ghsa: "GHSA-aaaa-bbbb-cccc", name: "picomatch" }),
      allowance({ expiresAt: "2027-11-18" }), NOW);
    expect(errors.some((e: string) => e.includes("90-day maximum"))).toBe(true);
  });

  it("fails an allowance that matches nothing, so a fixed advisory is deleted", () => {
    // Upstream published a patch and the advisory is gone. The allowance must
    // go with it instead of silently outliving the problem it was written for.
    const { errors } = evaluateMobileAudit(report(), allowance(), NOW);
    expect(errors.some((e: string) => e.includes("delete the allowance"))).toBe(true);
  });

  it("refuses an allowance pointed at a different package", () => {
    const { errors } = evaluateMobileAudit(
      report({ ghsa: "GHSA-aaaa-bbbb-cccc", name: "lodash" }), allowance(), NOW);
    expect(errors.some((e: string) => e.includes("reported against lodash"))).toBe(true);
  });

  it("treats an unreadable report as a failure, never as an empty one", () => {
    for (const bad of [null, undefined, {}, { vulnerabilities: null }, "nope"]) {
      expect(evaluateMobileAudit(bad, allowance(), NOW).errors.length).toBeGreaterThan(0);
    }
  });
});
