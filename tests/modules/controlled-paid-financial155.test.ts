// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C9.33/C12.38/C1.08. PREPARED/UNRUN: exact selection and physical identity controls.
import { describe, expect, it } from "vitest";
import { controlledPaidTargetScopes, mergeControlledPaidEntries } from "@/modules/invoicing/controlled-paid-financial";

const graph = {
  quotes: [{ id: "old-quote", profileId: "merchant-a" }, { id: "new-quote", profileId: "merchant-a" }, { id: "other-quote", profileId: "merchant-b" }],
  collections: [{ id: "old-paid", quoteId: "old-quote", invoiceId: "real-old-invoice" }, { id: "new-cashless", quoteId: "new-quote", invoiceId: null },
    { id: "other-paid", quoteId: "other-quote", invoiceId: "other-real-invoice" }],
};
const entry = { table: "subscription_controlled_paid_period_receipts" as const, id: "effect", fingerprint: "a".repeat(64), hashDomain: "postgres_row" as const,
  parents: { collectionId: "old-paid", resourceId: "original-resource", subscriptionId: "original-subscription", invoiceId: "real-old-invoice", termsId: "original-terms",
    renewalEventId: "actual-renewed", planEventId: null, profileId: "merchant-a" } };
describe("paid-period financial target composition155", () => {
  it("keeps the actual historical invoice when the next same-profile target is cashless", () => {
    expect(controlledPaidTargetScopes({ profileIds: ["merchant-a"] }, graph)).toEqual([{ profileId: "merchant-a", targets: [{ collectionId: "old-paid", invoiceId: "real-old-invoice" }] }]);
  });
  it("does not select a sibling merchant through a shared parent or original terms profile", () => {
    expect(controlledPaidTargetScopes({ profileIds: ["merchant-b", "merchant-b"] }, graph)).toEqual([{ profileId: "merchant-b", targets: [{ collectionId: "other-paid", invoiceId: "other-real-invoice" }] }]);
    expect(controlledPaidTargetScopes({ profileIds: ["unrelated-profile"] }, graph)).toEqual([]);
  });
  it("keeps all validated subject targets without needing a current cash route", () => {
    expect(controlledPaidTargetScopes({}, graph)).toEqual([{ targets: [{ collectionId: "old-paid", invoiceId: "real-old-invoice" }, { collectionId: "other-paid", invoiceId: "other-real-invoice" }] }]);
  });
  it("leaves an empty or only cashless target graph empty", () => {
    expect(controlledPaidTargetScopes({}, { quotes: [], collections: [] })).toEqual([]);
    expect(controlledPaidTargetScopes({}, { quotes: graph.quotes, collections: graph.collections.filter(row => row.invoiceId === null) })).toEqual([]);
  });
  it("refuses an unowned collection instead of discovering a parent/profile", () => {
    expect(() => controlledPaidTargetScopes({}, { quotes: [], collections: graph.collections })).toThrow(/exact complete paid-period/);
  });
  it("refuses contradictory quote profiles and conflicting collection invoice ownership", () => {
    expect(() => controlledPaidTargetScopes({}, { ...graph, quotes: [...graph.quotes, { id: "old-quote", profileId: "merchant-b" }] })).toThrow();
    expect(() => controlledPaidTargetScopes({}, { ...graph, collections: [...graph.collections, { id: "old-paid", quoteId: "old-quote", invoiceId: "changed-invoice" }] })).toThrow();
    expect(() => controlledPaidTargetScopes({}, { ...graph, collections: [...graph.collections, { id: "adopted", quoteId: "new-quote", invoiceId: "real-old-invoice" }] })).toThrow();
  });
  it("deduplicates repeated physical receipts without spending the aggregate budget twice", () => {
    expect(mergeControlledPaidEntries([[entry], [entry]], 4999)).toEqual([entry]);
    expect(mergeControlledPaidEntries([[], []], 5000)).toEqual([]);
  });
  it("refuses a changed full PostgreSQL SHA for the same exact physical UUID", () => {
    expect(() => mergeControlledPaidEntries([[entry], [{ ...entry, fingerprint: "b".repeat(64) }]])).toThrow();
  });
  it("refuses contradictory ancestry even when a supplied row hash is identical", () => {
    expect(() => mergeControlledPaidEntries([[entry], [{ ...entry, parents: { ...entry.parents, invoiceId: "other-invoice" } }]])).toThrow();
  });
  it("counts distinct actual receipts under one 5000-row bound", () => {
    expect(() => mergeControlledPaidEntries([[entry, { ...entry, id: "second-actual-effect" }]], 4999)).toThrow();
    expect(() => mergeControlledPaidEntries([[entry]], -1)).toThrow();
    expect(() => mergeControlledPaidEntries([], 5001)).toThrow();
  });
});
