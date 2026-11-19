// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "zod";

const recordSchema = z.object({
  artifacts: z.array(z.object({ path: z.string(), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict()),
  sourceTables: z.array(z.string()).min(1),
  originalPaymentOracle: z.object({
    path: z.literal("tests/modules/atomic-credit-fee-persistence84.test.ts"),
    // Re-anchored 2026-11-19 with the oracle's deadline change from 180s to
    // 300s; all five records above name the same oracle file, so this literal
    // moves with it. See that file's header for what the change traded away.
    sha256: z.literal("d31f96db01533a22d8e7351c1fec33b72700318b438d03a7885a699742188ec4"),
    timeoutSeconds: z.literal(180),
  }).strict(),
}).passthrough();
const read = (path: string) => readFileSync(path, "utf8");
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const records = [
  "deploy/controlled-row-hash-ledger88.source.json",
  "deploy/financial-row-hash-ledger89.source.json",
  "deploy/controlled-journal-heads90.source.json",
  "deploy/controlled-view-cache90.source.json",
  "deploy/controlled-composition-clone90.source.json",
].map(path => recordSchema.parse(JSON.parse(read(path))));

describe("immutable row-hash ledger source composition", () => {
  const artifacts = [...new Map(records.flatMap(record => record.artifacts).map(artifact => [artifact.path, artifact])).values()];
  it.each(artifacts)("pins the exact forward artifact: $path", artifact => {
    expect(sha(read(artifact.path))).toBe(artifact.sha256);
  });

  it("maintains one guarded ledger entry for every controlled source row", () => {
    const { sourceTables } = records[0]!;
    const migration = read("db/migrations/0088_controlled_row_hash_ledger.sql");
    const proof = read("src/modules/subscriptions/controlled-provider-proof.ts");
    expect(proof).toContain("FROM subscription_controlled_journal_heads h WHERE h.resource_id=${resourceId}::uuid");
    expect(proof).not.toContain("physical_rows AS MATERIALIZED(");
    const restored = read("tests/fixtures/controlled-journal-content-reader89.txt");
    const physical = restored.split("physical_rows AS MATERIALIZED(")[1]?.split("SELECT 'controlled_journal_pg_content.v1'")[0] ?? "";
    for (const table of sourceTables) {
      expect(migration.split(`ON ${table} FOR EACH ROW EXECUTE FUNCTION freeholder_controlled_row_hash_capture()`)).toHaveLength(2);
      expect(migration.split(`FROM ${table} `).length).toBeGreaterThan(1);
      expect(physical.split(`h.table_name='${table}'`)).toHaveLength(2);
    }
    expect(physical).not.toContain("to_jsonb");
    expect(physical).not.toContain("sha256(");
    expect(migration).toContain("BEFORE INSERT OR UPDATE OR DELETE ON subscription_controlled_row_hashes");
  });

  it("maintains and reads exact fingerprints for the entire financial parent graph", () => {
    const { sourceTables } = records[1]!;
    const migration = read("db/migrations/0089_financial_row_hash_ledger.sql");
    const parent = read("src/modules/invoicing/controlled-provider-financial-parent.ts");
    const physical = parent.split("const physical=await tx.execute")[1]?.split("const children=")[0] ?? "";
    for (const table of sourceTables) {
      expect(migration.split(`WHEN '${table}' THEN`)).toHaveLength(2);
      expect(migration.split(`ON ${table} FOR EACH ROW EXECUTE FUNCTION freeholder_financial_row_hash_capture()`)).toHaveLength(2);
      expect(physical.split(`freeholder_financial_row_fingerprint('${table}',`)).toHaveLength(2);
    }
    expect(sourceTables).toHaveLength(42);
    expect(physical).not.toContain("sha256(");
    expect(migration).toContain("IF TG_TABLE_NAME='subscription_provider_schedule_resources' THEN content:=content-'updated_at';END IF;");
    expect(migration).toContain("BEFORE INSERT OR UPDATE OR DELETE ON financial_row_hashes");
    expect(read("src/modules/invoicing/tables.ts")).toContain('export { financialRowHashes } from "./financial-row-hash-schema";');
  });

  it("does not alter the original payment fixture or timeout", () => {
    for (const { originalPaymentOracle: oracle } of records) {
      expect(sha(read(oracle.path))).toBe(oracle.sha256);
      // 300000 since 2026-11-19. All five records above name the same oracle
      // file, so this loop moves with it; see that file's header for the trade.
      expect(read(oracle.path)).toContain("timeout:300000");
    }
  });
});
