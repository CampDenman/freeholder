// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEPENDENCY_AUDIT_ATTESTATION_SCHEMA } from "../../scripts/dependency-audit.mjs";
import { verifyDependencyAuditAttestation } from "../../scripts/verify-dependency-attestation.mjs";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function sha256(path: string): Promise<string> {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function fixture(auditedAt = new Date()): Promise<{
  root: string;
  document: Record<string, unknown>;
}> {
  const root = await mkdtemp(join(tmpdir(), "freeholder-audit-proof-"));
  directories.push(root);
  await mkdir(join(root, "security"));
  const lockfile = join(root, "pnpm-lock.yaml");
  const ledger = join(root, "security", "dependency-audit-exceptions.json");
  await writeFile(lockfile, "lockfileVersion: '9.0'\n");
  await writeFile(ledger, '{"exceptions":[]}\n');
  return {
    root,
    document: {
      schema: DEPENDENCY_AUDIT_ATTESTATION_SCHEMA,
      auditedAt: auditedAt.toISOString(),
      lockfile: { algorithm: "sha256", digest: await sha256(lockfile) },
      exceptionLedger: { algorithm: "sha256", digest: await sha256(ledger) },
      policy: { neverExempt: ["critical", "high"], maximumExceptionDays: 90 },
      result: { advisories: 0, acceptedExceptions: 0 },
    },
  };
}

describe("dependency audit attestations", () => {
  it("accepts evidence for the exact lockfile and policy ledger", async () => {
    const { root, document } = await fixture();
    await expect(
      verifyDependencyAuditAttestation(document, { root, maximumAgeHours: 1 }),
    ).resolves.toBeUndefined();
  });

  it("rejects graph drift and stale evidence", async () => {
    const { root, document } = await fixture(new Date(Date.now() - 2 * 60 * 60_000));
    await writeFile(join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\nchanged: true\n");
    await expect(
      verifyDependencyAuditAttestation(document, { root, maximumAgeHours: 1 }),
    ).rejects.toThrow(/different lockfile/);

    const freshFixture = await fixture(new Date(Date.now() - 2 * 60 * 60_000));
    await expect(
      verifyDependencyAuditAttestation(freshFixture.document, {
        root: freshFixture.root,
        maximumAgeHours: 1,
      }),
    ).rejects.toThrow(/older than 1 hours/);
  });

  it("rejects malformed timestamps and impossible result counts", async () => {
    const malformed = await fixture();
    malformed.document.auditedAt = "today";
    await expect(
      verifyDependencyAuditAttestation(malformed.document, { root: malformed.root }),
    ).rejects.toThrow(/canonical UTC ISO date/);

    const impossible = await fixture();
    impossible.document.result = { advisories: 0, acceptedExceptions: 1 };
    await expect(
      verifyDependencyAuditAttestation(impossible.document, { root: impossible.root }),
    ).rejects.toThrow(/cannot exceed/);
  });
});
