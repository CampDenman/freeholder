// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C1.08/C9.33/C12.38: PREPARED/UNRUN synthetic read-driver controls only.
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { Tx } from "@/core/service";
import { prorationFinancialWitness, type ProrationFinancialParents, type ProrationFinancialTable } from "@/modules/invoicing/proration-financial-witness";

const id = (value: number) => `00000000-0000-4000-8000-${value.toString().padStart(12, "0")}`;
type Row = { id: string; parents: ProrationFinancialParents; fingerprint: string; valid: boolean };
type Inventory = Partial<Record<ProrationFinancialTable, Row[]>>;
const row = (value: number, parents: ProrationFinancialParents): Row => ({ id: id(value), parents, fingerprint: "a".repeat(64), valid: true });
function reader(inventory: Inventory, observe?: (table: string, query: string, parameters: unknown[]) => void) {
  const queries: string[] = [], dialect = new PgDialect();
  const tx = { execute: async (statement: SQL) => {
    const compiled = dialect.sqlToQuery(statement), table = compiled.sql.match(/\bvalid\s+from\s+"?([a-z_]+)"? r\b/)?.[1] as ProrationFinancialTable | undefined;
    if (!table) throw new Error("The actual bounded financial SELECT lost its original table alias.");
    expect(compiled.sql).toContain("sha256(convert_to(to_jsonb(r)::text");
    expect(compiled.params).toContain(5001);queries.push(table);observe?.(table, compiled.sql, compiled.params);
    const records = inventory[table] ?? [];
    if (table === "subscription_prorations") return records.filter(record => [record.id, record.parents.profileId, record.parents.subscriptionId,
      record.parents.sourceInvoiceId, record.parents.targetInvoiceId].some(value => value && compiled.params.includes(value)));
    if (table === "invoice_credit_funding") return records.filter(record => [record.id, record.parents.sourceProrationId, record.parents.sourceInvoiceId].some(value => value && compiled.params.includes(value))
      || inventory.invoice_credit_reservations?.some(target => target.parents.fundingId === record.id && target.parents.targetProrationId && compiled.params.includes(target.parents.targetProrationId)));
    return records;
  } } as unknown as Tx;
  return { tx, queries };
}
const accepted = (value: number, profile = 20, targetInvoice: number | null = null) => row(value, {
  prorationId: id(value), subscriptionId: id(10), profileId: id(profile), sourceInvoiceId: null,
  targetInvoiceId: targetInvoice === null ? null : id(targetInvoice), creditNoteId: null,
});

describe("exact original commercial financial witness adapter", () => {
  it("retains a cashless trial acceptance through its actual subscription without a payment or invoice", async () => {
    const mock = reader({ subscription_prorations: [accepted(1)] });
    const result = await prorationFinancialWitness(mock.tx, { kind: "subscription", ids: [id(10)] });
    expect(result.incomplete).toBe(false);expect(result.entries).toHaveLength(1);
    expect(result.entries[0]).toMatchObject({ family: "proration", table: "subscription_prorations", id: id(1), parents: { targetInvoiceId: null, sourceInvoiceId: null } });
    expect(mock.queries).not.toContain("payments");
  });
  it("retains an invoice's exact cashless commission duty before payment routing", async () => {
    const mock = reader({ subscription_prorations: [accepted(1, 20, 30)], agreement_fee_duties: [row(30, { invoiceId: id(30), prorationId: id(1), profileId: id(20), subscriptionId: id(10) })] });
    const result = await prorationFinancialWitness(mock.tx, { kind: "invoice", ids: [id(30)] });
    expect(result.incomplete).toBe(false);expect(result.entries.map(entry => entry.table)).toContain("agreement_fee_duties");
    expect(result.entries.some(entry => entry.parents.paymentId !== undefined)).toBe(false);
  });
  it("retains the exact original cash boundary receipt without exporting its private source body", async () => {
    const mock = reader({ subscription_prorations: [accepted(1, 20, 30)], commercial_payment_attestations: [row(60, { paymentId: id(60), invoiceId: id(30), profileId: id(20) })],
      subscription_proration_cash_confirmations: [row(60, { invoiceId: id(30), prorationId: id(1), profileId: id(20), paymentId: id(60), externalAttestationId: id(60), providerObservationId: null })] });
    const result = await prorationFinancialWitness(mock.tx, { kind: "invoice", ids: [id(30)] });
    expect(result.incomplete).toBe(false);
    expect(result.entries.find(entry => entry.family === "boundary")).toMatchObject({ table: "subscription_proration_cash_confirmations", fingerprint: "a".repeat(64), parents: { externalAttestationId: id(60) } });
    expect(Object.keys(result.entries[0]!)).toEqual(["family", "table", "id", "fingerprint", "parents"]);
  });
  it("closes target-side unapplied credit through the exact source funding and retains release history", async () => {
    const origin = { ...accepted(2, 20, 32), parents: { ...accepted(2, 20, 32).parents, sourceInvoiceId: id(31), creditNoteId: id(40) } };
    const fund = row(50, { fundingId: id(50), sourceProrationId: id(2), profileId: id(20), subscriptionId: id(10), sourceInvoiceId: id(31), sourcePaymentId: id(60), sourceApplicationId: null, creditNoteId: id(40), creditNoteLineId: id(41) });
    const reservation = row(70, { reservationId: id(70), fundingId: id(50), profileId: id(20), sourceProrationId: id(2), targetProrationId: id(1), subscriptionId: id(10), sourceInvoiceId: id(31), targetInvoiceId: id(30), creditNoteId: id(40) });
    const mock = reader({ subscription_prorations: [accepted(1, 20, 30), origin], invoice_credit_funding: [fund], invoice_credit_reservations: [reservation],
      invoice_credit_releases: [row(70, { reservationId: id(70), fundingId: id(50), sourceProrationId: id(2), profileId: id(20), sourceInvoiceId: id(31), creditNoteId: id(40) })] }, (table, query) => {
      if (table === "invoice_credit_funding") {
        expect(query).toContain("target_reservation.target_source_id=");expect(query).toContain("':proration:'");
        expect(query).toContain('"target"."id" in');
      }
      if (table === "invoice_credit_reservations") expect(query).toContain("owner.profile_id=target.profile_id");
    });
    const result = await prorationFinancialWitness(mock.tx, { kind: "invoice", ids: [id(30)] });
    expect(result.incomplete).toBe(false);
    expect(result.entries.filter(entry => entry.table === "subscription_prorations")).toHaveLength(2);
    expect(result.entries.find(entry => entry.table === "invoice_credit_funding")?.parents.sourcePaymentId).toBe(id(60));
    expect(result.entries.some(entry => entry.table === "invoice_credit_releases")).toBe(true);
    expect(result.entries.some(entry => entry.table === "invoice_credit_applications")).toBe(false);
  });
  it("uses frozen merchant profile selectors and refuses a foreign profile instead of adopting a mixed invoice", async () => {
    const mock = reader({ subscription_prorations: [accepted(1)] }, (table, query, parameters) => {
      if (table === "subscription_prorations") { expect(query).toContain('"r"."profile_id" in');expect(parameters).toContain(id(20)); }
      if (table === "commercial_payment_attestations") expect(query).toContain('"r"."merchant_profile_id" in');
    });
    expect((await prorationFinancialWitness(mock.tx, { kind: "merchant_profile", ids: [id(20)] })).incomplete).toBe(false);
    const foreign = reader({ commercial_payment_attestations: [row(60, { paymentId: id(60), invoiceId: id(30), profileId: id(21) })] });
    expect(await prorationFinancialWitness(foreign.tx, { kind: "merchant_profile", ids: [id(20)] })).toMatchObject({ incomplete: true, entries: [] });
  });
  it("refuses missing inherited original application proof, never amount-based ancestry", async () => {
    const original = { ...accepted(2), parents: { ...accepted(2).parents, sourceInvoiceId: id(31), creditNoteId: id(40) } };
    const mock = reader({ subscription_prorations: [original], invoice_credit_funding: [row(50, { sourceProrationId: id(2), profileId: id(20), sourceInvoiceId: id(31), sourcePaymentId: id(60), sourceApplicationId: id(70), creditNoteId: id(40) })] });
    expect(await prorationFinancialWitness(mock.tx, { kind: "invoice", ids: [id(31)] })).toMatchObject({ incomplete: true, entries: [] });
  });
  it("retains an inherited source application and its exact earlier funding/payment ancestry", async () => {
    const middle = { ...accepted(2, 20, 32), parents: { ...accepted(2, 20, 32).parents, sourceInvoiceId: id(31), creditNoteId: id(40) } };
    const earlier = { ...accepted(3, 20, 31), parents: { ...accepted(3, 20, 31).parents, sourceInvoiceId: id(33), creditNoteId: id(42) } };
    const mock = reader({ subscription_prorations: [accepted(1, 20, 30), middle, earlier], invoice_credit_funding: [
      row(50, { fundingId: id(50), sourceProrationId: id(2), profileId: id(20), sourceInvoiceId: id(31), sourcePaymentId: id(60), sourceApplicationId: id(71), creditNoteId: id(40) }),
      row(51, { fundingId: id(51), sourceProrationId: id(3), profileId: id(20), sourceInvoiceId: id(33), sourcePaymentId: id(60), sourceApplicationId: null, creditNoteId: id(42) }),
    ], invoice_credit_reservations: [
      row(70, { reservationId: id(70), fundingId: id(50), sourceProrationId: id(2), targetProrationId: id(1), profileId: id(20), sourceInvoiceId: id(31), targetInvoiceId: id(30) }),
      row(71, { reservationId: id(71), fundingId: id(51), sourceProrationId: id(3), targetProrationId: id(3), profileId: id(20), sourceInvoiceId: id(33), targetInvoiceId: id(31) }),
    ], invoice_credit_applications: [row(71, { applicationId: id(71), reservationId: id(71), fundingId: id(51), sourceProrationId: id(3), targetProrationId: id(3), profileId: id(20), sourceInvoiceId: id(33), targetInvoiceId: id(31) })] });
    const result = await prorationFinancialWitness(mock.tx, { kind: "invoice", ids: [id(30)] });
    expect(result.incomplete).toBe(false);expect(result.entries.filter(entry => entry.table === "invoice_credit_funding")).toHaveLength(2);
    expect(result.entries.find(entry => entry.table === "invoice_credit_applications")?.parents.targetInvoiceId).toBe(id(31));
    expect(result.entries.filter(entry => entry.table === "subscription_prorations")).toHaveLength(3);
  });
  it("refuses contradictory parent proof or a changed repeated original row hash", async () => {
    const bad = accepted(1);bad.valid = false;
    expect((await prorationFinancialWitness(reader({ subscription_prorations: [bad] }).tx, { kind: "subscription", ids: [id(10)] })).incomplete).toBe(true);
    const changing = accepted(1);let reads = 0;
    const mock = reader({ subscription_prorations: [changing] }, table => { if (table === "subscription_prorations" && ++reads > 1) changing.fingerprint = "b".repeat(64); });
    expect((await prorationFinancialWitness(mock.tx, { kind: "subscription", ids: [id(10)] })).incomplete).toBe(true);
  });
  it("refuses combined overflow without returning a partial financial snapshot", async () => {
    const mock = reader({ subscription_prorations: Array.from({ length: 5001 }, (_, index) => accepted(index + 1)) });
    expect(await prorationFinancialWitness(mock.tx, { kind: "subscription", ids: [id(10)] })).toMatchObject({ incomplete: true, entries: [] });
    expect(mock.queries).toHaveLength(1);
    const combined = reader({ subscription_prorations: Array.from({ length: 5000 }, (_, index) => accepted(index + 1)),
      commercial_payment_attestations: [row(60, { paymentId: id(60), invoiceId: id(30), profileId: id(20) })] });
    expect(await prorationFinancialWitness(combined.tx, { kind: "subscription", ids: [id(10)] })).toMatchObject({ incomplete: true, entries: [] });
  });
  it("refuses malformed roots before issuing any read", async () => {
    const mock = reader({});expect((await prorationFinancialWitness(mock.tx, { kind: "invoice", ids: ["amount-is-not-an-owner"] })).incomplete).toBe(true);
    expect(mock.queries).toEqual([]);
  });
});
