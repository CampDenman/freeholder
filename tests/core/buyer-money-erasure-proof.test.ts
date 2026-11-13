// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38/C1.08: original queue inventory is proof, never today's absence alone.
import { describe, expect, it } from "vitest";
import { originalBuyerMoneyInventory } from "@/modules/invoicing/buyer-money-erasure-proof";
import { merchantTaxDigest } from "@/modules/invoicing/merchant-tax-store";
const id = "00000000-0000-4000-8000-000000000001";
const other = "00000000-0000-4000-8000-000000000002";
const expected = { requestId: id, originalJobId: other };
const original = { ...expected, originalAgreementIds: [id, other], originalPaymentIds: [other] };
describe("original buyer money-finisher inventory", () => {
  it("returns the actual immutable original IDs independently of JSON key order", () => {
    const reordered = { originalPaymentIds: [other], originalAgreementIds: [id, other], originalJobId: other, requestId: id };
    expect(originalBuyerMoneyInventory(reordered, merchantTaxDigest(original), expected)).toEqual(original);
  });
  it("refuses an invented empty set under the original populated enqueue hash", () => {
    expect(originalBuyerMoneyInventory({ ...original, originalAgreementIds: [] }, merchantTaxDigest(original), expected)).toBeNull();
  });
  it("accepts an explicitly captured empty set only under its actual original hash", () => {
    const empty = { ...original, originalAgreementIds: [] };
    expect(originalBuyerMoneyInventory(empty, merchantTaxDigest(empty), expected)).toEqual(empty);
    expect(originalBuyerMoneyInventory(original, merchantTaxDigest(empty), expected)).toBeNull();
  });
  it("refuses missing original queue data or missing durable enqueue proof", () => {
    expect(originalBuyerMoneyInventory(undefined, merchantTaxDigest(original), expected)).toBeNull();
    expect(originalBuyerMoneyInventory(original, undefined, expected)).toBeNull();
  });
  it("never assigns another original request or real job's inventory to this finisher", () => {
    for (const changed of [{ ...original, requestId: other }, { ...original, originalJobId: id }]) {
      expect(originalBuyerMoneyInventory(changed, merchantTaxDigest(changed), expected)).toBeNull();
    }
  });
  it("refuses duplicates, invalid IDs and unexpected admission fields even with a matching rewritten hash", () => {
    for (const changed of [{ ...original, originalAgreementIds: [id, id] }, { ...original, originalAgreementIds: ["not-an-id"] },
      { ...original, currentMerchant: "invented" }, { ...original, originalPaymentIds: [other, other] }]) {
      expect(originalBuyerMoneyInventory(changed, merchantTaxDigest(changed), expected)).toBeNull();
    }
  });
  it("requires a new actual enqueue proof for a changed original child list", () => {
    expect(originalBuyerMoneyInventory({ ...original, originalAgreementIds: [other] }, merchantTaxDigest(original), expected)).toBeNull();
    expect(originalBuyerMoneyInventory({ ...original, originalAgreementIds: [other, id] }, merchantTaxDigest(original), expected)).toBeNull();
    expect(originalBuyerMoneyInventory({ ...original, originalPaymentIds: [] }, merchantTaxDigest(original), expected)).toBeNull();
  });
});
