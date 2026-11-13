// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C1.08/C12.38: PREPARED/UNRUN registered undo callbacks, synthetic reads only.
import { createHash } from "node:crypto";
import { getTableName, type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ContactReference } from "@/core/contacts/service";
import type { Tx } from "@/core/service";
import type { ProrationFinancialParents, ProrationFinancialTable } from "@/modules/invoicing/proration-financial-witness";

const seams = vi.hoisted(() => ({ references: new Map<string, ContactReference>(), dependencies: vi.fn<(
  tx: Tx, invoiceIds: readonly string[], paymentIds?: readonly string[], additionalWitnessCount?: number,
) => Promise<Map<string, string> | null>>() }));
vi.mock("@/core/contacts/service", () => ({ registerContactReference: (reference: ContactReference) => seams.references.set(reference.table, reference) }));
vi.mock("@/core/privacy/service", () => ({ registerContactPrivacySource: vi.fn() }));
vi.mock("@/modules/invoicing/merchant-payment-dependencies", () => ({ invoiceMerchantDependencyFingerprints: seams.dependencies }));
import "@/modules/members/merchant-identity-privacy";

const id = (n: number) => `30000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
type Row = { id: string; fingerprint: string; parents: ProrationFinancialParents; valid: boolean };
type Inventory = Partial<Record<ProrationFinancialTable, Row[]>>;
const row = (n: number, parents: ProrationFinancialParents): Row => ({ id: id(n), fingerprint: "a".repeat(64), parents: { profileId: id(20), ...parents }, valid: true });
const accepted = () => row(1, { prorationId: id(1), subscriptionId: id(10), sourceInvoiceId: null, targetInvoiceId: id(30), creditNoteId: null });
const cash = () => row(60, { paymentId: id(60), invoiceId: id(30) });
const fee = () => row(70, { paymentId: id(60), invoiceId: id(30), originalRemittanceId: null });
const card = { prorationId: id(1), subscriptionId: id(10), invoiceId: id(30), paymentId: id(60) };
const collection = (n = 40, profileId = id(20)) => ({ id: id(n), invoiceId: id(30), profileId, sellerUserId: id(110), material: "original-private-collection-row" });
const policy = () => ({ id: id(10), contactId: id(90), material: "original-private-subscription-policy-row" });
type Owner = Pick<ReturnType<typeof collection>, "id" | "invoiceId" | "profileId" | "sellerUserId"> & { collectionInvoiceId: string };
type Route = { paymentId: string; allocationId: string; invoiceId: string; paymentInvoiceId: string; sellerUserId: string; collectionInvoiceId: string; profileId: string };
type Source = { paymentId: string; invoiceId: string; sourceType: string; sourceId: string; subscriptionId: string; sellerUserId: string };
type Data = { collections?: ReturnType<typeof collection>[]; policies?: ReturnType<typeof policy>[]; routes?: { paymentId: string }[]; owners?: Owner[]; routeFacts?: Route[]; sourceFacts?: Source[]; financial?: Inventory };
function reader(data: Data, inspect?: (table: string, query: string, params: unknown[]) => void) {
  const dialect = new PgDialect(), selects: string[] = [], financialReads: string[] = [];
  const tx = {
    select: (fields: Record<string, unknown>) => {
      let table = "", parameters: unknown[] = [];
      const chain = {
        from: (source: Parameters<typeof getTableName>[0]) => { table = getTableName(source);selects.push(table);return chain; },
        innerJoin: () => chain,
        leftJoin: () => chain,
        where: (statement: SQL) => { const compiled = dialect.sqlToQuery(statement);parameters = compiled.params;inspect?.(table, compiled.sql, compiled.params);return chain; },
        orderBy: () => chain,
        limit: async (count: number) => {
          expect(count).toBe(5001);
          if (table === "invoice_merchant_collections") {
            const profile = fields.profileId;
            expect(profile).toBeDefined();
            const compiled = dialect.sqlToQuery(profile as SQL);
            expect(compiled.sql).toContain('"invoice_merchant_collections"."tax_policy"');expect(compiled.sql).toContain("->>'profileId'");
            return data.collections ?? [];
          }
          if (table === "invoice_merchant_allocations") return (data.owners ?? (data.collections ?? []).map(source => ({ ...source, collectionInvoiceId: source.invoiceId }))).filter(owner => parameters.includes(owner.invoiceId));
          if (table === "subscription_market_policies") return data.policies ?? [];
          if (table === "merchant_payment_routes") return fields.allocationId ? (data.routeFacts ?? []).filter(route => parameters.includes(route.paymentId)) : data.routes ?? [];
          if (table === "payments") return (data.sourceFacts ?? []).filter(original => parameters.includes(original.paymentId));
          throw new Error(`Unexpected identity parent table ${table}. No current profile/account lookup is allowed.`);
        },
      };
      return chain;
    },
    execute: async (statement: SQL) => {
      const { sql: query, params } = dialect.sqlToQuery(statement), table = query.match(/\bvalid\s+from\s+"?([a-z_]+)"? r\b/)?.[1] as ProrationFinancialTable | undefined;
      if (!table) throw new Error("Original financial table identity was lost.");
      expect(query).toContain("sha256(convert_to(to_jsonb(r)::text");expect(params).toContain(5001);
      financialReads.push(table);inspect?.(table, query, params);return data.financial?.[table] ?? [];
    },
    update: vi.fn(() => { throw new Error("A read-only conflict must not restore any contact pointer."); }),
  } as unknown as Tx;
  return { tx, selects, financialReads };
}
function reference(table: string) {
  const registered = seams.references.get(table);if (!registered) throw new Error(`Missing actual registered reference ${table}`);return registered;
}
const capture = (table: string, tx: Tx) => reference(table).captureForUndo(tx, id(90), id(91));

describe("exact original merchant identity financial snapshots", () => {
  beforeEach(() => { seams.dependencies.mockReset();seams.dependencies.mockResolvedValue(new Map()); });
  it("preserves old empty history fingerprints and existing UUID-only receipt shapes byte-for-byte", async () => {
    const source = { collections: [collection()], policies: [policy()] }, mock = reader(source);
    expect(await capture("invoice_merchant_collections", mock.tx)).toEqual({ undoable: true, state: [{ id: id(40), fingerprint: hash(JSON.stringify({ material: collection().material })) }] });
    expect(await capture("subscription_market_policies", mock.tx)).toEqual({ undoable: true, state: [{ id: id(10), contactId: id(90), fingerprint: hash(policy().material) }] });
    expect(seams.dependencies).toHaveBeenCalledWith(mock.tx, [id(30)], [], 1);
  });
  it("uses the actual frozen taxPolicy profile even with no profile contact and an empty payment filter", async () => {
    const financial: Inventory = { subscription_prorations: [accepted()] }, mock = reader({ collections: [collection()], financial }, (table, query, params) => {
      if (table === "subscription_prorations") { expect(query).toContain('"r"."profile_id" in');expect(params).toContain(id(20)); }
    });
    const first = await capture("invoice_merchant_collections", mock.tx);
    expect(first.undoable).toBe(true);expect(first.state).not.toEqual((await capture("invoice_merchant_collections", reader({ collections: [collection()] }).tx)).state);
    expect(mock.selects).toEqual(["invoice_merchant_collections", "invoice_merchant_allocations", "merchant_payment_routes"]);
    expect(seams.dependencies.mock.calls[0]).toEqual([mock.tx, [id(30)], [], 2]);
    expect(JSON.stringify(first.state)).not.toContain("original-private");expect(JSON.stringify(first.state)).not.toContain("prorationFinancial");
  });
  it.each(["subscription_prorations", "commercial_payment_attestations", "commercial_fee_attestations", "subscription_proration_card_reads"] as const)("refuses collection undo after a changed full %s row", async table => {
    const financial: Inventory = { subscription_prorations: [accepted()], commercial_payment_attestations: [cash()], commercial_fee_attestations: [fee()],
      subscription_proration_payment_protocols: [row(60, card)], subscription_proration_card_reads: [row(80, { ...card, readId: id(80) })] };
    const mock = reader({ collections: [collection()], financial }), before = await capture("invoice_merchant_collections", mock.tx);
    expect(before.undoable).toBe(true);financial[table]![0]!.fingerprint = "b".repeat(64);
    await expect(reference("invoice_merchant_collections").restoreAfterUndo(mock.tx, [], before.state, id(90), id(91))).rejects.toMatchObject({ code: "conflict" });
    expect(seams.dependencies.mock.calls.every(call => JSON.stringify(call[2]) === "[]")).toBe(true);
  });
  it("roots agreement-policy history in its exact subscription ID before any invoice or cash exists", async () => {
    const financial: Inventory = { subscription_prorations: [{ ...accepted(), parents: { ...accepted().parents, targetInvoiceId: null } }] };
    const mock = reader({ policies: [policy()], financial }, (table, query, params) => {
      if (table === "subscription_prorations") { expect(query).toContain('"r"."subscription_id" in');expect(params).toContain(id(10));expect(params).not.toContain(id(90)); }
    });
    const after = await capture("subscription_market_policies", mock.tx);expect(after.undoable).toBe(true);
    financial.subscription_prorations![0]!.fingerprint = "b".repeat(64);
    await expect(reference("subscription_market_policies").restoreAfterUndo(mock.tx, [], after.state, id(90), id(91))).rejects.toMatchObject({ code: "conflict" });
    expect(seams.dependencies).not.toHaveBeenCalled();expect(mock.selects.every(table => table === "subscription_market_policies")).toBe(true);
  });
  it("retains existing routed-payment filters and adds only the distinct real external witness count", async () => {
    const mock = reader({ collections: [collection(), { ...collection(41), invoiceId: id(31) }], routes: [{ paymentId: id(60) }], financial: { subscription_prorations: [accepted()] } });
    expect((await capture("invoice_merchant_collections", mock.tx)).undoable).toBe(true);
    expect(seams.dependencies).toHaveBeenCalledWith(mock.tx, [id(30), id(31)], [id(60)], 3);
    seams.dependencies.mockResolvedValue(null);
    expect(await capture("invoice_merchant_collections", mock.tx)).toMatchObject({ undoable: false, state: [] });
  });
  it("retains separate physical tables sharing a payment or read UUID in the hash and complete count", async () => {
    const financial: Inventory = { subscription_prorations: [accepted()], commercial_payment_attestations: [cash()],
      subscription_proration_payment_protocols: [row(60, card)], subscription_proration_card_reads: [row(80, { ...card, readId: id(80) })],
      subscription_proration_card_read_finishes: [row(80, { ...card, readId: id(80) })] };
    const mock = reader({ collections: [collection()], financial }), first = await capture("invoice_merchant_collections", mock.tx);
    expect(first.undoable).toBe(true);expect(seams.dependencies).toHaveBeenLastCalledWith(mock.tx, [id(30)], [], 6);
    financial.subscription_proration_card_read_finishes![0]!.fingerprint = "b".repeat(64);
    const second = await capture("invoice_merchant_collections", mock.tx);expect(second.undoable).toBe(true);expect(second.state).not.toEqual(first.state);
    expect(seams.dependencies).toHaveBeenLastCalledWith(mock.tx, [id(30)], [], 6);
  });
  it("excludes unrelated same-profile histories outside the collection's actual invoice/source subgraph", async () => {
    const unrelated = row(2, { prorationId: id(2), subscriptionId: id(11), sourceInvoiceId: null, targetInvoiceId: id(31), creditNoteId: null });
    const financial: Inventory = { subscription_prorations: [accepted(), unrelated] }, mock = reader({ collections: [collection()], financial });
    const first = await capture("invoice_merchant_collections", mock.tx);expect(first.undoable).toBe(true);
    unrelated.fingerprint = "b".repeat(64);
    expect((await capture("invoice_merchant_collections", mock.tx)).state).toEqual(first.state);
    expect(seams.dependencies).toHaveBeenLastCalledWith(mock.tx, [id(30)], [], 2);
    const onlyUnrelated = reader({ collections: [collection()], financial: { subscription_prorations: [unrelated] } });
    expect((await capture("invoice_merchant_collections", onlyUnrelated.tx)).state).toEqual([{ id: id(40), fingerprint: hash(JSON.stringify({ material: collection().material })) }]);
  });
  it("refuses ambiguous shared-platform cashless children but attributes physical payments only through real allocation FKs", async () => {
    const owner = collection(), foreign = { ...collection(41), sellerUserId: id(111) };
    const owners = [owner, foreign].map(value => ({ ...value, collectionInvoiceId: id(30) }));
    const ambiguous = reader({ collections: [owner], owners, financial: { subscription_prorations: [accepted()] } });
    expect(await capture("invoice_merchant_collections", ambiguous.tx)).toMatchObject({ undoable: false, state: [] });
    expect(seams.dependencies).not.toHaveBeenCalled();
    const foreignCash = row(61, { paymentId: id(61), invoiceId: id(30) });
    const financial: Inventory = { commercial_payment_attestations: [cash(), foreignCash] };
    const routeFacts = [owner, foreign].map((value, index) => ({ paymentId: id(60 + index), allocationId: value.id, invoiceId: id(30), paymentInvoiceId: id(30), sellerUserId: value.sellerUserId, collectionInvoiceId: id(30), profileId: id(20) }));
    const exact = reader({ collections: [owner], owners, routes: [{ paymentId: id(60) }], routeFacts, financial });
    const first = await capture("invoice_merchant_collections", exact.tx);expect(first.undoable).toBe(true);
    foreignCash.fingerprint = "b".repeat(64);expect((await capture("invoice_merchant_collections", exact.tx)).state).toEqual(first.state);
    expect(seams.dependencies).toHaveBeenLastCalledWith(exact.tx, [id(30)], [id(60)], 2);
    routeFacts[0]!.paymentInvoiceId = id(999);
    expect(await capture("invoice_merchant_collections", exact.tx)).toMatchObject({ undoable: false, state: [] });
  });
  it("retains genuine source/target credit ancestry and refuses a different original source allocation owner", async () => {
    const financial: Inventory = {
      subscription_prorations: [accepted(), row(2, { prorationId: id(2), subscriptionId: id(11), sourceInvoiceId: id(31), targetInvoiceId: id(32), creditNoteId: id(50) })],
      commercial_payment_attestations: [row(62, { paymentId: id(62), invoiceId: id(31) })],
      invoice_credit_funding: [row(51, { fundingId: id(51), sourceProrationId: id(2), subscriptionId: id(11), sourceInvoiceId: id(31), sourcePaymentId: id(62), sourceApplicationId: null, creditNoteId: id(50), creditNoteLineId: id(52) })],
      invoice_credit_reservations: [row(71, { reservationId: id(71), fundingId: id(51), sourceProrationId: id(2), targetProrationId: id(1), sourceInvoiceId: id(31), targetInvoiceId: id(30), creditNoteId: id(50) })],
      invoice_credit_applications: [row(71, { applicationId: id(71), reservationId: id(71), fundingId: id(51), sourceProrationId: id(2), targetProrationId: id(1), sourceInvoiceId: id(31), targetInvoiceId: id(30), creditNoteId: id(50) })],
    };
    const routeFacts = [{ paymentId: id(62), allocationId: id(42), invoiceId: id(31), paymentInvoiceId: id(31), sellerUserId: id(110), collectionInvoiceId: id(31), profileId: id(20) }];
    const mock = reader({ collections: [collection()], routeFacts, financial }), first = await capture("invoice_merchant_collections", mock.tx);
    expect(first.undoable).toBe(true);expect(seams.dependencies).toHaveBeenLastCalledWith(mock.tx, [id(30)], [], 7);
    financial.commercial_payment_attestations![0]!.fingerprint = "b".repeat(64);
    await expect(reference("invoice_merchant_collections").restoreAfterUndo(mock.tx, [], first.state, id(90), id(91))).rejects.toMatchObject({ code: "conflict" });
    routeFacts[0]!.sellerUserId = id(111);
    expect(await capture("invoice_merchant_collections", mock.tx)).toMatchObject({ undoable: false, state: [] });
    const sourceFacts = [{ paymentId: id(62), invoiceId: id(31), sourceType: "subscription", sourceId: `${id(11)}:period:original`, subscriptionId: id(11), sellerUserId: id(110) }];
    const manual = reader({ collections: [collection()], sourceFacts, financial });
    expect((await capture("invoice_merchant_collections", manual.tx)).undoable).toBe(true);
    sourceFacts[0]!.sellerUserId = id(111);
    expect(await capture("invoice_merchant_collections", manual.tx)).toMatchObject({ undoable: false, state: [] });
    sourceFacts[0]!.sellerUserId = id(110);sourceFacts[0]!.sourceId = `${id(12)}:period:original`;
    expect(await capture("invoice_merchant_collections", manual.tx)).toMatchObject({ undoable: false, state: [] });
  });
  it("refuses foreign or malformed frozen profile roots and incomplete original ancestry instead of adopting mixed-invoice parties", async () => {
    const foreign = accepted();foreign.parents.profileId = id(21);
    for (const data of [{ collections: [collection()], financial: { subscription_prorations: [foreign] } },
      { collections: [collection(40, "not-an-original-profile-UUID")] },
      { collections: [collection()], financial: { subscription_proration_card_reads: [row(80, { ...card, readId: id(80) })] } }]) {
      const mock = reader(data);expect(await capture("invoice_merchant_collections", mock.tx)).toMatchObject({ undoable: false, state: [] });
    }
    expect(seams.dependencies).not.toHaveBeenCalled();
  });
  it("bounds all identity parent rows plus distinct financial children at5000 before the payment reader", async () => {
    const many = Array.from({ length: 4999 }, (_, index) => ({ ...collection(index + 100), invoiceId: index ? id(index + 20000) : id(30) }));
    const exact = reader({ collections: many, financial: { subscription_prorations: [accepted()] } });
    expect((await capture("invoice_merchant_collections", exact.tx)).undoable).toBe(true);
    expect(seams.dependencies.mock.lastCall?.[2]).toEqual([]);expect(seams.dependencies.mock.lastCall?.[3]).toBe(5000);
    seams.dependencies.mockClear();
    const overflow = reader({ collections: [...many, { ...collection(6000), invoiceId: id(60000) }], financial: { subscription_prorations: [accepted()] } });
    expect(await capture("invoice_merchant_collections", overflow.tx)).toMatchObject({ undoable: false, state: [] });
    expect(seams.dependencies).not.toHaveBeenCalled();
    expect(await capture("subscription_market_policies", reader({ policies: Array.from({ length: 5001 }, () => policy()) }).tx)).toMatchObject({ undoable: false, state: [] });
  });
});
