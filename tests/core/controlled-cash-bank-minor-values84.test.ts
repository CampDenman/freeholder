// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C12.38/C9.33: whole-function regression for repeated physical amount sites.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "zod";
const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const hash = (text: string | Buffer) => createHash("sha256").update(text).digest("hex");
const manifest = z.object({
  prefix: z.object({ bytes: z.number(), sha256: z.string() }),
  assembled: z.object({ bytes: z.number(), sha256: z.string() }),
  fragment: z.object({ path: z.string(), sha256: z.string() }),
  bankFunction: z.object({ originalBodySha256: z.string(), afterBodySha256: z.string(), singlePassReversePattern: z.string() }),
  validatorBodySha256: z.string(),
}).parse(JSON.parse(read("deploy/controlled-cash-bank-minor-sites84.manifest.json")));
const fragment = read(manifest.fragment.path);
function body(sql: string, name: string) {
  const start = sql.lastIndexOf(`FUNCTION ${name}(`), begin = sql.indexOf("AS $$", start), end = sql.indexOf("$$;", begin);
  if (start < 0 || begin < 0 || end < 0) throw Error("Retain the whole actual SQL function.");
  return sql.slice(begin + 5, end);
}
describe("complete repeated bank amount extraction", () => {
  it("reverses all seven physical sites simultaneously to the entire original bank body", () => {
    const bank = body(fragment, "freeholder_controlled_cash_bank_invoice");
    const pattern = new RegExp(manifest.bankFunction.singlePassReversePattern, "g");
    expect([...bank.matchAll(pattern)]).toHaveLength(7);
    const original = bank.replace(pattern, (_match, value: string) => `freeholder_controlled_bank_minor(${value},false)`);
    expect(hash(original)).toBe(manifest.bankFunction.originalBodySha256);
    expect(hash(bank)).toBe(manifest.bankFunction.afterBodySha256);
    expect(bank).not.toMatch(/CASE WHEN\s*\(CASE WHEN/);
  });
  it("guards both repeated payment amount reads independently and never leaves a boolean amount assignment", () => {
    const bank = body(fragment, "freeholder_controlled_cash_bank_invoice");
    expect(bank.match(/payment_minor=\(CASE WHEN freeholder_controlled_bank_minor\(payment_atom->'amount_paid',false\)/g)).toHaveLength(2);
    expect(bank).not.toMatch(/(?:total_minor|paid_minor|remaining_minor|received_minor|payment_minor)=freeholder_controlled_bank_minor/);
  });
  it("keeps every prior migrated byte and exactly materializes the new owned suffix", () => {
    const normal = Buffer.from(read("db/migrations/0085_controlled_collection_application.sql"));
    expect(normal.length).toBeGreaterThanOrEqual(manifest.assembled.bytes);
    const frozen = normal.subarray(0, manifest.assembled.bytes);
    expect(hash(frozen)).toBe(manifest.assembled.sha256);
    expect(hash(normal.subarray(0, manifest.prefix.bytes))).toBe(manifest.prefix.sha256);
    expect(frozen.subarray(manifest.prefix.bytes).toString()).toBe(`\n--> statement-breakpoint\n${fragment}`);
    expect(read("deploy/sql/0085_controlled_collection_application.unapplied.sql")).toBe(normal.toString());
  });
  it("preserves the complete previous readiness predicates while changing only the corrected bank body pin", () => {
    const previous = read("deploy/controlled-cash-bank-minor-value84.fragment.sql");
    const before = body(previous, "freeholder_controlled_subscription_route_ready");
    const ready = body(fragment, "freeholder_controlled_subscription_route_ready");
    expect(ready).toBe(before.replace(hash(body(previous, "freeholder_controlled_cash_bank_invoice")), manifest.bankFunction.afterBodySha256));
    expect(ready).toContain(manifest.validatorBodySha256);
    expect(hash(fragment)).toBe(manifest.fragment.sha256);
  });
});
