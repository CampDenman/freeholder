// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: a stable tax number cannot hide a changed commercial agreement.
import { describe, expect, it } from "vitest";
import { bookingCommercialPrice } from "@/core/scheduling/commercial-quote";
import { bookingCommercialConsentDigest } from "@/modules/members/booking-merchant-quote";

const terms = {
  offeringId: "00000000-0000-4000-8000-000000000001", sellerUserId: "00000000-0000-4000-8000-000000000002",
  merchantName: "Original public business", merchantSupport: { email: "support@example.com", phone: null, url: null, address: null },
  collectionKind: "destination" as const, providerPlatformAccountId: "acct_originalplatform", recipientAccountId: "acct_originalseller", siteFeeBps: 1000,
  price: { currency: "CAD", mode: "deposit_balance" as const, seats: 2, baseAmountMinor: 2000, dueNowMinor: 500, taxCategoryCode: "standard" }, taxQuoteDigest: "a".repeat(64),
};
describe("original booking commercial consent (C12.38)", () => {
  it("requires fresh consent for a changed public business, recipient, namespace, price or selected payment mode even when tax is unchanged", () => {
    const accepted = bookingCommercialConsentDigest(terms);
    for (const changed of [
      { ...terms, merchantName: "Another business" },
      { ...terms, merchantSupport: { ...terms.merchantSupport, email: "other@example.com" } },
      { ...terms, recipientAccountId: "acct_anotherrecipient" },
      { ...terms, providerPlatformAccountId: "acct_anotherplatform" },
      { ...terms, collectionKind: "direct" as const },
      { ...terms, price: { ...terms.price, baseAmountMinor: 2001 } },
      { ...terms, price: { ...terms.price, mode: "full" as const } },
      { ...terms, price: { ...terms.price, dueNowMinor: 501 } },
      { ...terms, price: { ...terms.price, seats: 3 } },
      { ...terms, price: { ...terms.price, taxCategoryCode: "services" } },
      { ...terms, taxQuoteDigest: "b".repeat(64) },
    ]) expect(bookingCommercialConsentDigest(changed)).not.toBe(accepted);
    expect(bookingCommercialConsentDigest({ ...terms, merchantSupport: { address: null, url: null, phone: null, email: "support@example.com" } })).toBe(accepted);
  });
  it("rejects impossible deposits, unsafe money and missing original currency instead of coercing a buyer-supplied amount", () => {
    expect(bookingCommercialPrice.safeParse(terms.price).success).toBe(true);
    expect(bookingCommercialPrice.safeParse({ ...terms.price, dueNowMinor: 2001 }).success).toBe(false);
    expect(bookingCommercialPrice.safeParse({ ...terms.price, baseAmountMinor: Number.MAX_SAFE_INTEGER + 1 }).success).toBe(false);
    expect(bookingCommercialPrice.safeParse({ ...terms.price, currency: "" }).success).toBe(false);
  });
});
