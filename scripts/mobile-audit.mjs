// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Customer-app dependency audit with named, expiring allowances (C1.20, §36).
//
// `npm audit` is all-or-nothing: it has no per-advisory allowance, so the only
// ways to pass a tree with one unpatchable advisory are to raise
// --audit-level until the gate stops meaning anything, or to drop the step.
// Both lose every OTHER advisory in ~600 packages, including any that would
// reach a customer's device.
//
// This keeps the gate at its real severity and names the exceptions instead,
// the same shape as the `allow-ghsas` list on the dependency-review step in
// .github/workflows/ci.yml. Three properties matter:
//
//   - an advisory that is not named here fails the build, whatever it is;
//   - an allowance past its expiry fails, so it is re-argued, not inherited;
//   - an allowance that matches nothing ALSO fails, so the day upstream
//     publishes a fix the entry has to be deleted rather than quietly
//     outliving the problem it was written for.
//
// The pnpm workspace is governed separately and more strictly by
// scripts/dependency-audit.mjs, where high and critical have no bypass at all.
// This file covers apps/mobile only, which sits outside that workspace.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const MOBILE = fileURLToPath(new URL("../apps/mobile", import.meta.url));

/**
 * Every allowance is a dated argument, not a mute. There are none right now.
 *
 * The first and so far only entry was GHSA-fc5q-39xc-vjpf (picomatch, ReDoS
 * through single-branch repeated extglobs), and GitHub WITHDREW that advisory
 * on 2026-11-18 at 15:38 UTC, hours after it was written. `pnpm audit` reports
 * nothing against this tree, so the allowance became dead weight and the
 * unused-allowance refusal below is what said so — it is cheaper to delete an
 * argument than to leave one standing for a finding nobody makes any more.
 * An empty map is meaningful evidence, exactly as the empty exception ledger
 * is for the root audit: no accepted customer-app dependency risk.
 */
const ALLOWED = new Map([]);

const MAX_ALLOWANCE_DAYS = 90;

function day(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const stamp = Date.parse(`${value}T00:00:00Z`);
  return Number.isNaN(stamp) ? null : stamp;
}

/** Pure, so the gate can be proved to fail as well as to pass. */
export function evaluateMobileAudit(report, allowed = ALLOWED, now = new Date()) {
  const errors = [];
  const found = new Map();
  const vulnerabilities = report && typeof report === "object"
    ? report.vulnerabilities
    : null;
  if (!vulnerabilities || typeof vulnerabilities !== "object") {
    return { errors: ["npm audit produced no vulnerabilities object"], found };
  }
  for (const entry of Object.values(vulnerabilities)) {
    for (const via of Array.isArray(entry?.via) ? entry.via : []) {
      // A string `via` is another package in the same cascade, not a root
      // advisory. Only the object form carries the GHSA.
      if (!via || typeof via !== "object") continue;
      const identifier = /GHSA-[0-9a-z-]+/i.exec(String(via.url ?? ""))?.[0];
      if (!identifier) {
        errors.push(`advisory without a GHSA identifier: ${via.title ?? "unknown"}`);
        continue;
      }
      found.set(identifier, { package: via.name, severity: via.severity, title: via.title });
    }
  }
  for (const [identifier, advisory] of found) {
    const allowance = allowed.get(identifier);
    if (!allowance) {
      errors.push(`${identifier} (${advisory.severity}) in ${advisory.package} is not allowed: ${advisory.title}`);
      continue;
    }
    if (allowance.package !== advisory.package) {
      errors.push(`${identifier} is allowed for ${allowance.package}, but reported against ${advisory.package}`);
    }
    const reviewedAt = day(allowance.reviewedAt);
    const expiresAt = day(allowance.expiresAt);
    if (reviewedAt === null || expiresAt === null) {
      errors.push(`${identifier}: reviewedAt and expiresAt must be YYYY-MM-DD`);
      continue;
    }
    if (expiresAt < now.getTime()) {
      errors.push(`${identifier}: allowance expired on ${allowance.expiresAt}; re-argue it or fix the dependency`);
    }
    if (expiresAt - reviewedAt > MAX_ALLOWANCE_DAYS * 86_400_000) {
      errors.push(`${identifier}: allowance exceeds the ${MAX_ALLOWANCE_DAYS}-day maximum`);
    }
  }
  for (const identifier of allowed.keys()) {
    if (!found.has(identifier)) {
      errors.push(`${identifier} is allowed but no longer reported — delete the allowance`);
    }
  }
  return { errors, found };
}

function main() {
  const result = spawnSync("npm", ["audit", "--package-lock-only", "--json"], {
    cwd: MOBILE, encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) {
    console.error(`Customer app audit could not run: ${result.error.message}`);
    process.exit(1);
  }
  let report;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    // A non-zero exit is normal when advisories exist; unparseable output is not.
    console.error("Customer app audit produced no parseable JSON report.");
    process.exit(1);
  }
  const { errors, found } = evaluateMobileAudit(report);
  if (errors.length) {
    console.error("Customer app dependency audit failed:");
    for (const error of errors) console.error(`  - ${error}`);
    process.exit(1);
  }
  const counts = report?.metadata?.vulnerabilities ?? {};
  console.log(
    `Customer app audit: ${found.size} root advisory/advisories, all named allowances ` +
    `(${counts.critical ?? 0} critical, ${counts.high ?? 0} high, ${counts.moderate ?? 0} moderate in the cascade).`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
