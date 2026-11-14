// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// PREPARED/UNRUN. Exact fixture/oracle preservation, no native acceptance claim.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "zod";
const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const steps = z.array(z.object({ before: z.string(), after: z.string() }));
const manifest = z.object({
  defaultCheckout: z.object({ path: z.string(), name: z.string(), bodySha256: z.string() }),
  defaultProvider: z.object({ path: z.string(), name: z.string(), bodySha256: z.string() }),
  defaultPeriod: z.object({ path: z.string(), sha256: z.string() }),
  newProvider: z.object({ path: z.string(), name: z.string(), sha256: z.string(), reverseSteps: steps }),
  newPeriod: z.object({ path: z.string(), sha256: z.string(), reverseSteps: steps, reverseSeedName: z.object({ before: z.string(), after: z.string() }) }),
  native: z.object({ path: z.string(), beforeSha256: z.string(), afterSha256: z.string(), reverseSteps: steps }),
  unchangedRuntime: z.array(z.object({ path: z.string(), sha256: z.string() })),
}).parse(JSON.parse(read("deploy/cartless-paid-merge155.manifest.json")));
function body(text: string, name: string, end?: string) {
  const start = text.indexOf(`export async function ${name}(`), finish = end ? text.indexOf(end, start) : text.length;
  if (start < 0 || finish < 0) throw Error("Preserve the entire actual constructor body.");
  return text.slice(start, finish);
}
function reverse(text: string, replacements: z.infer<typeof steps>) {
  for (const { before, after } of replacements) { expect(text.split(before)).toHaveLength(2); text = text.replace(before, after); }
  return text;
}
describe("cartless genuine paid merge precondition", () => {
  it("keeps every original default constructor byte-identical", () => {
    expect(hash(body(read(manifest.defaultCheckout.path), manifest.defaultCheckout.name, "\n/** Actual catalogue/merchant/customer"))).toBe(manifest.defaultCheckout.bodySha256);
    expect(hash(body(read(manifest.defaultProvider.path), manifest.defaultProvider.name, "\n/** Same real provider producer"))).toBe(manifest.defaultProvider.bodySha256);
    expect(hash(read(manifest.defaultPeriod.path))).toBe(manifest.defaultPeriod.sha256);
  });
  it("reverses the entire new provider path to the original genuine producer and creates no artificial cart", () => {
    const actual = body(read(manifest.newProvider.path), manifest.newProvider.name);
    expect(hash(actual)).toBe(manifest.newProvider.sha256); expect(hash(reverse(actual, manifest.newProvider.reverseSteps))).toBe(manifest.defaultProvider.bodySha256);
    expect(actual).toContain("const variant = fixture.variants[0]"); expect(actual).not.toContain("fixture.cart");
    const catalogue = body(read(manifest.defaultCheckout.path), "seedMerchantCatalogue80");
    expect(catalogue).toContain("await getProductVariants.call"); expect(catalogue).toContain("variants.push(variant)");
    expect(catalogue).not.toMatch(/getOrCreateCart|addCartItem|checkoutCart|quoteMerchantCheckout/);
  });
  it("reverses the whole explicit period constructor to the exact original while retaining a genuine zero-cart precondition", () => {
    const actual = read(manifest.newPeriod.path); expect(hash(actual)).toBe(manifest.newPeriod.sha256);
    const original = reverse(actual, manifest.newPeriod.reverseSteps).replaceAll(manifest.newPeriod.reverseSeedName.before, manifest.newPeriod.reverseSeedName.after);
    expect(hash(original)).toBe(manifest.defaultPeriod.sha256);
    expect(actual).toContain("if(unrelatedCarts.length)throw Error"); expect(actual).not.toMatch(/\.delete\(|\.update\(carts\)|erase|detach/);
  });
  it("reverses the complete native file to every original business, timestamp, XID, merge, undo and export assertion", () => {
    const actual = read(manifest.native.path); expect(hash(actual)).toBe(manifest.native.afterSha256);
    expect(hash(reverse(actual, manifest.native.reverseSteps))).toBe(manifest.native.beforeSha256);
    expect(actual.match(/f = await actualCartlessControlledPeriod84\(\)/g)).toHaveLength(1);
    expect(actual).toContain("[survivor.id, f.parent.contactId]"); expect(actual).toContain("await undoContactMerge.call");
  });
  it("leaves all runtime/cart undo policy and money/access code unchanged", () => {
    for (const file of manifest.unchangedRuntime) expect(hash(read(file.path))).toBe(file.sha256);
    const policy = read("src/modules/catalog/cart.ts"); expect(policy).toContain("undoable: rows.length === 0");
    expect(policy).toContain("Open carts were merged and cannot be split back apart safely.");
  });
});
