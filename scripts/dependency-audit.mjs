// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Enforce the dependency-risk contract (MASTER.md C1.20, §36).
//
// High and critical advisories have no bypass. Lower severities remain visible
// too: each must be patched or represented by one owned, path-complete,
// expiring exception. The checked-in empty ledger is meaningful evidence that
// the current lockfile has no accepted dependency risk.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const EXCEPTIONS_PATH = fileURLToPath(
  new URL("../security/dependency-audit-exceptions.json", import.meta.url),
);
const LOWER_SEVERITIES = new Set(["info", "low", "moderate"]);
const NEVER_EXEMPT = new Set(["high", "critical"]);
const MAX_EXCEPTION_DAYS = 90;

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : null;
}

function date(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }
  const [year, month, day] = value.split("-").map(Number);
  const exact = new Date(Date.UTC(year, month - 1, day));
  if (
    exact.getUTCFullYear() !== year ||
    exact.getUTCMonth() !== month - 1 ||
    exact.getUTCDate() !== day
  ) return null;
  const parsed = Date.parse(`${value}T23:59:59.999Z`);
  return Number.isFinite(parsed) ? parsed : null;
}

function advisoryKey(advisory) {
  return String(advisory.github_advisory_id ?? advisory.id ?? "unknown");
}

function findingPaths(advisory) {
  return [...new Set(
    (Array.isArray(advisory.findings) ? advisory.findings : [])
      .flatMap((finding) => Array.isArray(finding?.paths) ? finding.paths : [])
      .filter((path) => typeof path === "string" && path.length > 0),
  )].sort();
}

function validateException(exception, now) {
  const errors = [];
  const key = typeof exception.advisory === "string" ? exception.advisory : "unknown";
  if (!/^GHSA-[a-z0-9-]+$/i.test(key)) {
    errors.push(`${key}: exception advisory must be a GHSA identifier`);
  }
  if (typeof exception.package !== "string" || !exception.package.trim()) {
    errors.push(`${key}: exception must name the package`);
  }
  if (!LOWER_SEVERITIES.has(exception.severity)) {
    errors.push(`${key}: only info, low, or moderate advisories may be excepted`);
  }
  if (!Array.isArray(exception.paths) || exception.paths.length === 0 ||
      exception.paths.some((path) => typeof path !== "string" || !path.trim())) {
    errors.push(`${key}: exception must list every affected dependency path`);
  }
  for (const field of ["owner", "reason", "remediation"]) {
    if (typeof exception[field] !== "string" || exception[field].trim().length < 12) {
      errors.push(`${key}: exception ${field} must be at least 12 characters`);
    }
  }
  const reviewedAt = date(exception.reviewedAt);
  const expiresAt = date(exception.expiresAt);
  if (reviewedAt === null || expiresAt === null) {
    errors.push(`${key}: reviewedAt and expiresAt must be YYYY-MM-DD dates`);
  } else {
    if (reviewedAt > now.getTime()) errors.push(`${key}: review date is in the future`);
    if (expiresAt < now.getTime()) errors.push(`${key}: exception expired on ${exception.expiresAt}`);
    if (expiresAt < reviewedAt) errors.push(`${key}: exception expires before it was reviewed`);
    if (expiresAt - reviewedAt > MAX_EXCEPTION_DAYS * 86_400_000) {
      errors.push(`${key}: exception exceeds the ${MAX_EXCEPTION_DAYS}-day maximum`);
    }
  }
  return errors;
}

/** Pure policy evaluation, exported so the gate can prove that it fails. */
export function evaluateDependencyAudit(report, ledger, now = new Date()) {
  const errors = [];
  const warnings = [];
  const reportRecord = record(report);
  const advisoriesRecord = record(reportRecord?.advisories);
  const ledgerRecord = record(ledger);
  if (!reportRecord || !advisoriesRecord) {
    return {
      ok: false,
      advisories: 0,
      errors: ["pnpm audit did not return a valid advisory report"],
      warnings,
    };
  }
  if (!ledgerRecord || !Array.isArray(ledgerRecord.exceptions)) {
    return {
      ok: false,
      advisories: Object.keys(advisoriesRecord).length,
      errors: ["dependency exception ledger must contain an exceptions array"],
      warnings,
    };
  }

  const exceptions = ledgerRecord.exceptions.map((value) => record(value) ?? {});
  const byKey = new Map();
  for (const exception of exceptions) {
    errors.push(...validateException(exception, now));
    if (typeof exception.advisory === "string") {
      if (byKey.has(exception.advisory)) {
        errors.push(`${exception.advisory}: duplicate exception`);
      }
      byKey.set(exception.advisory, exception);
    }
  }

  const liveKeys = new Set();
  for (const advisory of Object.values(advisoriesRecord).map(record).filter(Boolean)) {
    const key = advisoryKey(advisory);
    const severity = String(advisory.severity ?? "unknown").toLowerCase();
    const packageName = String(advisory.module_name ?? "unknown");
    liveKeys.add(key);
    if (NEVER_EXEMPT.has(severity)) {
      errors.push(`${key}: ${severity} advisory in ${packageName}; high/critical findings cannot be excepted`);
      continue;
    }
    if (!LOWER_SEVERITIES.has(severity)) {
      errors.push(`${key}: unrecognized severity ${severity}`);
      continue;
    }
    const exception = byKey.get(key);
    if (!exception) {
      errors.push(`${key}: undocumented ${severity} advisory in ${packageName}`);
      continue;
    }
    if (exception.package !== packageName) {
      errors.push(`${key}: exception names ${exception.package}, audit reports ${packageName}`);
    }
    if (exception.severity !== severity) {
      errors.push(`${key}: exception severity ${exception.severity} does not match ${severity}`);
    }
    const documentedPaths = new Set(Array.isArray(exception.paths) ? exception.paths : []);
    const livePaths = new Set(findingPaths(advisory));
    for (const path of livePaths) {
      if (!documentedPaths.has(path)) errors.push(`${key}: dependency path is not documented: ${path}`);
    }
    for (const path of documentedPaths) {
      if (!livePaths.has(path)) errors.push(`${key}: exception contains a stale dependency path: ${path}`);
    }
    warnings.push(`${key}: accepted ${severity} exception expires ${exception.expiresAt}`);
  }

  for (const key of byKey.keys()) {
    if (!liveKeys.has(key)) errors.push(`${key}: stale exception; the advisory is no longer reported`);
  }
  return {
    ok: errors.length === 0,
    advisories: Object.keys(advisoriesRecord).length,
    errors,
    warnings,
  };
}

function runPnpmAudit() {
  const pnpmScript = process.env.npm_execpath;
  const command = pnpmScript
    ? process.execPath
    : process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  const args = pnpmScript
    ? [pnpmScript, "audit", "--json"]
    : ["audit", "--json"];
  const result = spawnSync(command, args, {
    encoding: "utf8",
    maxBuffer: 16 * 1_024 * 1_024,
    windowsHide: true,
  });
  if (result.error) throw result.error;
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error(
      `pnpm audit did not return JSON${result.stderr ? `: ${result.stderr.trim()}` : ""}`,
    );
  }
}

function main() {
  let report;
  let ledger;
  try {
    report = runPnpmAudit();
    ledger = JSON.parse(readFileSync(EXCEPTIONS_PATH, "utf8"));
  } catch (error) {
    console.error(`Dependency audit could not run: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
  const result = evaluateDependencyAudit(report, ledger);
  for (const warning of result.warnings) console.warn(`Dependency audit exception: ${warning}`);
  if (!result.ok) {
    console.error(
      "Dependency audit failed. Patch the dependency, or document a lower-severity " +
        "exception under SECURITY.md's contract:\n" +
        result.errors.map((error) => `  - ${error}`).join("\n"),
    );
    process.exit(1);
  }
  console.log(
    result.advisories === 0
      ? "Dependency audit: no known advisories."
      : `Dependency audit: ${result.advisories} documented lower-severity exception(s).`,
  );
}

if (process.argv[1] && process.argv[1].endsWith("dependency-audit.mjs")) {
  main();
}
