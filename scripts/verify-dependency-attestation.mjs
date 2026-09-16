// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Verify that a successful live audit belongs to this exact dependency graph.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DEPENDENCY_AUDIT_ATTESTATION_SCHEMA } from "./dependency-audit.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : null;
}

async function digest(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

export async function verifyDependencyAuditAttestation(
  document,
  { root = repositoryRoot, now = new Date(), maximumAgeHours } = {},
) {
  const value = record(document);
  assert.ok(value, "dependency audit attestation must be an object");
  assert.equal(value.schema, DEPENDENCY_AUDIT_ATTESTATION_SCHEMA);
  const lockfile = record(value.lockfile);
  const ledger = record(value.exceptionLedger);
  const policy = record(value.policy);
  const result = record(value.result);
  assert.equal(lockfile?.algorithm, "sha256");
  assert.equal(ledger?.algorithm, "sha256");
  assert.equal(
    lockfile?.digest,
    await digest(resolve(root, "pnpm-lock.yaml")),
    "dependency audit was produced for a different lockfile",
  );
  assert.equal(
    ledger?.digest,
    await digest(resolve(root, "security/dependency-audit-exceptions.json")),
    "dependency audit was produced for a different exception ledger",
  );
  assert.deepEqual(policy?.neverExempt, ["critical", "high"]);
  assert.equal(policy?.maximumExceptionDays, 90);
  assert.ok(Number.isInteger(result?.advisories) && Number(result?.advisories) >= 0);
  assert.ok(
    Number.isInteger(result?.acceptedExceptions) &&
      Number(result?.acceptedExceptions) >= 0,
  );
  assert.ok(
    Number(result?.acceptedExceptions) <= Number(result?.advisories),
    "accepted exceptions cannot exceed reported advisories",
  );

  const auditedAtText = typeof value.auditedAt === "string" ? value.auditedAt : "";
  assert.match(
    auditedAtText,
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
    "audit timestamp must be a canonical UTC ISO date",
  );
  const auditedAt = Date.parse(auditedAtText);
  assert.ok(Number.isFinite(auditedAt), "audit timestamp must be a real date");
  assert.ok(auditedAt <= now.getTime() + 5 * 60_000, "audit timestamp is in the future");
  if (maximumAgeHours !== undefined) {
    assert.ok(
      Number.isFinite(maximumAgeHours) && maximumAgeHours > 0,
      "maximum audit age must be positive",
    );
    assert.ok(
      now.getTime() - auditedAt <= maximumAgeHours * 60 * 60_000,
      `dependency audit is older than ${maximumAgeHours} hours`,
    );
  }
}

async function main() {
  const pathArgument = process.argv[2];
  assert.ok(pathArgument, "usage: verify-dependency-attestation.mjs <path> [--max-age-hours=N]");
  const ageArgument = process.argv.find((value) => value.startsWith("--max-age-hours="));
  const maximumAgeHours = ageArgument
    ? Number(ageArgument.slice("--max-age-hours=".length))
    : undefined;
  const document = JSON.parse(await readFile(resolve(pathArgument), "utf8"));
  await verifyDependencyAuditAttestation(document, { maximumAgeHours });
  console.log("Dependency audit attestation matches this lockfile and policy ledger.");
}

if (process.argv[1]?.endsWith("verify-dependency-attestation.mjs")) {
  await main();
}
