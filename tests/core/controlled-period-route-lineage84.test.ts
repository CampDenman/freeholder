// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// PREPARED/UNRUN. Whole source-body preservation, not an executed bank oracle.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "zod";
const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const hash = (text: string | Buffer) => createHash("sha256").update(text).digest("hex");
const manifest = z.object({
  prefix: z.object({ path: z.string(), bytes: z.number(), sha256: z.string() }),
  fragment: z.object({ path: z.string(), bytes: z.number(), sha256: z.string() }),
  periodFunction: z.object({ beforeBodySha256: z.string(), afterBodySha256: z.string(), exactInsertedBranch: z.string() }),
  readyFunction: z.object({ beforeBodySha256: z.string(), afterBodySha256: z.string(), exactAdditionalPins: z.string() }),
}).parse(JSON.parse(read("deploy/controlled-period-route-lineage84.manifest.json")));
const fragment = read(manifest.fragment.path);
function body(text: string, name: string) {
  const declaration = [...text.matchAll(new RegExp(`^CREATE(?: OR REPLACE)? FUNCTION ${name}\\(`, "gm"))].at(-1);
  const start = declaration?.index ?? -1, begin = text.indexOf("AS $$", start), end = text.indexOf("$$;", begin);
  if (start < 0 || begin < 0 || end < 0) throw Error("Retain the entire authentic SQL function.");
  return text.slice(begin + 5, end);
}
describe("exact original controlled period route branch", () => {
  it("restores every byte of the ordinary legacy policy by removing the one inserted branch", () => {
    const actual = body(fragment, "freeholder_subscription_period_cash_application");
    expect(actual.split(manifest.periodFunction.exactInsertedBranch)).toHaveLength(2);
    const original = actual.replace(manifest.periodFunction.exactInsertedBranch, "");
    expect(original).toBe(body(read("deploy/subscription-commercial-amendments80.fragment.sql"), "freeholder_subscription_period_cash_application"));
    expect(hash(original)).toBe(manifest.periodFunction.beforeBodySha256);
    expect(hash(actual)).toBe(manifest.periodFunction.afterBodySha256);
  });
  it("requires the full actual stage verifier and refuses a controlled candidate before any legacy fallback", () => {
    const branch = manifest.periodFunction.exactInsertedBranch;
    expect(branch).toContain("controlled_origin.receipt_id=NEW.original_charge_receipt_id");
    expect(branch).toContain("controlled_link.payment_id=NEW.payment_id");
    expect(branch).toContain("OR NOT EXISTS(SELECT 1 FROM subscription_controlled_charge_origins");
    expect(branch).toContain("freeholder_controlled_subscription_route_valid(to_jsonb(NEW)) IS DISTINCT FROM true");
    expect(branch).toContain("RAISE EXCEPTION"); expect(branch).not.toContain("current_setting");
    const actual = body(fragment, "freeholder_subscription_period_cash_application");
    expect(actual.indexOf(branch)).toBeLessThan(actual.indexOf("IF NEW.origin_kind<>'provider_schedule' THEN RETURN NEW; END IF;"));
  });
  it("preserves the entire newest route readiness body and adds only the exact changed body and enabled trigger pins", () => {
    const ready = body(fragment, "freeholder_controlled_subscription_route_ready");
    const previous = body(read("deploy/controlled-cash-bank-minor-sites84.fragment.sql"), "freeholder_controlled_subscription_route_ready");
    expect(ready.replace(manifest.readyFunction.exactAdditionalPins, "")).toBe(previous);
    expect(hash(previous)).toBe(manifest.readyFunction.beforeBodySha256); expect(hash(ready)).toBe(manifest.readyFunction.afterBodySha256);
    expect(ready).toContain(manifest.periodFunction.afterBodySha256);
    expect(ready).toContain("t.tgname='merchant_agreement_period_lineage'"); expect(ready).toContain("t.tgtype=7 AND NOT t.tgisinternal");
    expect(ready).toContain("t.tgenabled IN('O','A')");
    expect(ready).toContain("ea997a78b7a85655575edcc669ecbb41c4a6caee608f357696d164657e9dc48f");
    expect(ready).toContain("05d891ce5a52f018a9c5b6f21d9c3ae43f68d7abd7e831fb2cf512cff476a68e");
  });
  it("keeps the complete existing migration prefix unchanged and supplies only an unapplied owned successor", () => {
    const normal = Buffer.from(read(manifest.prefix.path));
    expect(normal.length).toBeGreaterThanOrEqual(manifest.prefix.bytes);
    expect(hash(normal.subarray(0, manifest.prefix.bytes))).toBe(manifest.prefix.sha256);
    expect(hash(fragment)).toBe(manifest.fragment.sha256); expect(Buffer.byteLength(fragment)).toBe(manifest.fragment.bytes);
    expect(fragment.match(/CREATE OR REPLACE FUNCTION/g)).toHaveLength(2);
    expect(fragment).not.toMatch(/CREATE (?:CONSTRAINT )?TRIGGER|ALTER TABLE|DISABLE TRIGGER|DROP /);
  });
});
