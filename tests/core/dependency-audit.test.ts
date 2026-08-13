// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The dependency gate proves both its hard boundary and exception discipline.
import { describe, expect, it } from "vitest";
import { evaluateDependencyAudit } from "../../scripts/dependency-audit.mjs";

function report(advisories: Record<string, unknown>) {
  return { advisories, metadata: { vulnerabilities: {} } };
}

function advisory(severity: string, paths = [".>tool>affected"]) {
  return {
    id: 123,
    github_advisory_id: "GHSA-aaaa-bbbb-cccc",
    module_name: "affected",
    severity,
    findings: [{ version: "1.0.0", paths }],
  };
}

function exception(overrides: Record<string, unknown> = {}) {
  return {
    advisory: "GHSA-aaaa-bbbb-cccc",
    package: "affected",
    severity: "moderate",
    paths: [".>tool>affected"],
    owner: "security maintainer",
    reason: "Development-only parser is never exposed to untrusted input.",
    remediation: "Upgrade the parent package when its compatible fix is released.",
    reviewedAt: "2026-08-01",
    expiresAt: "2026-09-01",
    ...overrides,
  };
}

const now = new Date("2026-08-12T12:00:00Z");

describe("dependency advisory policy", () => {
  it("passes a clean report with an empty ledger", () => {
    expect(evaluateDependencyAudit(report({}), { exceptions: [] }, now))
      .toMatchObject({ ok: true, advisories: 0, errors: [] });
  });

  it("never permits a high or critical exception", () => {
    for (const severity of ["high", "critical"]) {
      const result = evaluateDependencyAudit(
        report({ 123: advisory(severity) }),
        { exceptions: [exception({ severity })] },
        now,
      );
      expect(result.ok).toBe(false);
      expect(result.errors.join("\n")).toMatch(/cannot be excepted/);
    }
  });

  it("requires every lower-severity advisory to be documented", () => {
    const result = evaluateDependencyAudit(
      report({ 123: advisory("moderate") }),
      { exceptions: [] },
      now,
    );
    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      "GHSA-aaaa-bbbb-cccc: undocumented moderate advisory in affected",
    );
  });

  it("accepts a complete, owned and time-boxed lower-severity exception", () => {
    const result = evaluateDependencyAudit(
      report({ 123: advisory("moderate") }),
      { exceptions: [exception()] },
      now,
    );
    expect(result).toMatchObject({ ok: true, advisories: 1, errors: [] });
    expect(result.warnings[0]).toMatch(/expires 2026-09-01/);
  });

  it("rejects undocumented paths and report drift", () => {
    const result = evaluateDependencyAudit(
      report({ 123: advisory("moderate", [".>first>affected", ".>second>affected"]) }),
      { exceptions: [exception({
        package: "different",
        paths: [".>first>affected", ".>obsolete>affected"],
      })] },
      now,
    );
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toMatch(/names different/);
    expect(result.errors.join("\n")).toMatch(/second>affected/);
    expect(result.errors.join("\n")).toMatch(/stale dependency path/);
  });

  it("rejects expired, overlong, duplicate and stale exceptions", () => {
    const expired = evaluateDependencyAudit(
      report({ 123: advisory("moderate") }),
      { exceptions: [exception({ expiresAt: "2026-08-11" })] },
      now,
    );
    const overlong = evaluateDependencyAudit(
      report({ 123: advisory("moderate") }),
      { exceptions: [exception({ expiresAt: "2027-08-01" })] },
      now,
    );
    const staleAndDuplicate = evaluateDependencyAudit(
      report({}),
      { exceptions: [exception(), exception()] },
      now,
    );
    expect(expired.errors.join("\n")).toMatch(/expired/);
    expect(overlong.errors.join("\n")).toMatch(/90-day maximum/);
    expect(staleAndDuplicate.errors.join("\n")).toMatch(/duplicate/);
    expect(staleAndDuplicate.errors.join("\n")).toMatch(/stale exception/);
  });

  it("fails closed on malformed audit output or ledger", () => {
    expect(evaluateDependencyAudit({}, { exceptions: [] }, now).ok).toBe(false);
    expect(evaluateDependencyAudit(report({}), {}, now).ok).toBe(false);
    expect(evaluateDependencyAudit(
      report({ 123: advisory("moderate") }),
      { exceptions: [exception({ paths: {}, reviewedAt: "2026-02-31" })] },
      now,
    ).ok).toBe(false);
  });
});
