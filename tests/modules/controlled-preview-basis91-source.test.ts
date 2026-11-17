// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { restoreRowHashLedgerSource } from "../helpers/row-hash-ledger-forward";

const record = z.object({
  artifacts: z.array(z.object({ path: z.string(), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict()),
  testContinuations: z.array(z.object({ path: z.string(), beforeSha256: z.string() }).passthrough()),
  originalPaymentOracle: z.object({ path: z.string(), sha256: z.string(), timeoutSeconds: z.literal(180) }).strict(),
  functionBodies: z.record(z.string(), z.string().regex(/^[a-f0-9]{64}$/)),
}).passthrough().parse(JSON.parse(readFileSync("deploy/controlled-preview-basis91.source.json", "utf8")));
const read = (path: string) => readFileSync(path, "utf8");
const sha = (source: string) => createHash("sha256").update(source).digest("hex");

describe("nonfinancial preview planning and atomic confirmation birth source", () => {
  it.each(record.artifacts)("pins the exact current artifact: $path", artifact => {
    const current = read(artifact.path);
    expect(sha(current)).toBe(artifact.sha256);
    const continuation = record.testContinuations.find(row => row.path === artifact.path);
    if (continuation) expect(sha(restoreRowHashLedgerSource(artifact.path, current, continuation.beforeSha256))).toBe(continuation.beforeSha256);
  });

  it("pins both final guard bodies and their current readiness identity", () => {
    const migration = read("db/migrations/0091_atomic_credit_confirmation_birth.sql");
    for (const [name, digest] of Object.entries(record.functionBodies)) {
      expect(migration).toContain(name);
      expect(migration).toContain(digest);
    }
    expect(migration.split("subscription_proration_credit_confirmations").length).toBeGreaterThan(2);
    expect(migration).toContain("actual_confirmation");
    expect(migration).toContain("IF NOT freeholder_credit_atomic_fee_ready() THEN RAISE EXCEPTION");
    expect(migration).toContain("accepted_by ~ '^(user:|agent:|plugin:|system$)'");
  });

  it("revalidates the complete physical disposition instead of repeating its semantic evaluation", () => {
    const source = read("src/modules/invoicing/atomic-credit-invoice-disposition.ts");
    expect(source.split("const before=await readDisposition(ctx,input)")).toHaveLength(2);
    expect(source).not.toContain("const after=await readDisposition(ctx,input)");
    expect(source.split("freeholder_controlled_cash_parent_snapshot(")).toHaveLength(3);
    expect(source).toContain("if(after?.revision!==before.physicalRevision)refuse();return before;");
  });

  it("does not alter the original payment oracle or deadline", () => {
    expect(sha(read(record.originalPaymentOracle.path))).toBe(record.originalPaymentOracle.sha256);
    expect(read(record.originalPaymentOracle.path)).toContain("timeout:180000");
  });
});
