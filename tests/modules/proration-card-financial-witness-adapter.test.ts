// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C1.08/C9.33/C12.38: PREPARED/UNRUN actual SQL with synthetic read results.
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { Tx } from "@/core/service";
import { prorationFinancialWitness, type ProrationFinancialParents, type ProrationFinancialTable } from "@/modules/invoicing/proration-financial-witness";

const id = (value: number) => `10000000-0000-4000-8000-${value.toString().padStart(12, "0")}`;
type Row = { id: string; fingerprint: string; parents: ProrationFinancialParents; valid: boolean; privateBody?: string };
type Inventory = Partial<Record<ProrationFinancialTable, Row[]>>;
const row = (value: number, parents: ProrationFinancialParents): Row => ({ id: id(value), fingerprint: "a".repeat(64), parents, valid: true });
const parent = () => row(1, { prorationId: id(1), subscriptionId: id(10), profileId: id(20), sourceInvoiceId: null, targetInvoiceId: id(30), creditNoteId: null });
const cardParent = { prorationId: id(1), subscriptionId: id(10), profileId: id(20), invoiceId: id(30) };
function inventory(saved = false): Inventory {
  return { subscription_prorations: [parent()], subscription_proration_payment_protocols: [row(60, { ...cardParent, paymentId: id(60) })],
    subscription_proration_card_reads: [row(80, { ...cardParent, readId: id(80), paymentId: id(60) })],
    ...(saved ? { subscription_proration_card_mandates: [row(1, { ...cardParent, paymentMethodId: id(40) })],
      subscription_proration_card_attempts: [row(60, { ...cardParent, paymentId: id(60), paymentMethodId: id(40) })],
      subscription_proration_card_jobs: [row(70, { ...cardParent, jobId: id(70) })] } : {}) };
}
function reader(original: Inventory, inspect?: (table: string, query: string, parameters: unknown[]) => void) {
  const dialect = new PgDialect();
  return { execute: async (statement: SQL) => {
    const { sql: query, params } = dialect.sqlToQuery(statement);
    const table = query.match(/\bvalid\s+from\s+"?([a-z_]+)"? r\b/)?.[1] as ProrationFinancialTable | undefined;
    if (!table) throw new Error("The actual card witness SELECT lost its physical table identity.");
    expect(query).toContain("sha256(convert_to(to_jsonb(r)::text");expect(params).toContain(5001);
    inspect?.(table, query, params);return original[table] ?? [];
  } } as unknown as Tx;
}

describe("exact original card financial witness integration", () => {
  it("retains an unfinished hosted reader without inventing a stored-method mandate or attempt", async () => {
    const original = inventory();
    const result = await prorationFinancialWitness(reader(original, (table, query) => {
      if (table === "subscription_proration_card_reads") {
        expect(query).toContain("protocol.payment_id=cash.id");expect(query).toContain("owner.debit_invoice_id=target_invoice.id");
        expect(query).toContain("target_invoice.source_id=");expect(query).toContain("':proration:'");
        expect(query).not.toContain("subscription_proration_card_attempts");expect(query).not.toContain("subscription_proration_card_mandates");
      }
    }), { kind: "invoice", ids: [id(30)] });
    expect(result.incomplete).toBe(false);
    expect(result.entries.filter(entry => entry.family === "card").map(entry => entry.table)).toEqual(["subscription_proration_card_reads", "subscription_proration_payment_protocols"]);
    expect(result.entries.some(entry => entry.table === "subscription_proration_card_read_finishes" || entry.table === "subscription_proration_card_read_stops")).toBe(false);
  });
  it("keeps all seven saved-method families and distinct actual finish/stop UUID ancestry", async () => {
    const original = inventory(true);
    original.subscription_proration_card_reads!.push(row(81, { ...cardParent, readId: id(81), paymentId: id(60) }));
    original.subscription_proration_card_read_finishes = [row(80, { ...cardParent, readId: id(80), paymentId: id(60) })];
    original.subscription_proration_card_read_stops = [row(81, { ...cardParent, readId: id(81), paymentId: id(60) })];
    const result = await prorationFinancialWitness(reader(original), { kind: "subscription", ids: [id(10)] });
    expect(result.incomplete).toBe(false);expect(new Set(result.entries.filter(entry => entry.family === "card").map(entry => entry.table)).size).toBe(7);
    expect(result.entries.find(entry => entry.table === "subscription_proration_card_jobs")).toMatchObject({ id: id(70), parents: { jobId: id(70), prorationId: id(1) } });
    expect(result.entries.find(entry => entry.table === "subscription_proration_card_read_finishes")?.parents.readId).toBe(id(80));
    expect(result.entries.find(entry => entry.table === "subscription_proration_card_read_stops")?.parents.readId).toBe(id(81));
  });
  it("constrains merchant card selection to accepted profile-owned targets, never the whole mixed invoice", async () => {
    const result = await prorationFinancialWitness(reader(inventory(), (table, query, parameters) => {
      if (table === "subscription_prorations") expect(query).toContain('"r"."profile_id" in');
      if (table.startsWith("subscription_proration_card_") || table === "subscription_proration_payment_protocols") {
        expect(query).toContain('"owner"."id" in');expect(parameters).toContain(id(1));expect(parameters).not.toContain(id(30));
      }
    }), { kind: "merchant_profile", ids: [id(20)] });
    expect(result.incomplete).toBe(false);
    const foreign = inventory();foreign.subscription_proration_card_reads![0]!.parents.profileId = id(21);
    expect(await prorationFinancialWitness(reader(foreign), { kind: "merchant_profile", ids: [id(20)] })).toMatchObject({ incomplete: true, entries: [] });
  });
  it("refuses missing original protocol, mandate or collection job instead of borrowing current defaults", async () => {
    const noProtocol = inventory();noProtocol.subscription_proration_payment_protocols = [];
    expect((await prorationFinancialWitness(reader(noProtocol), { kind: "invoice", ids: [id(30)] })).incomplete).toBe(true);
    const noMandate = inventory(true);noMandate.subscription_proration_card_mandates = [];
    expect((await prorationFinancialWitness(reader(noMandate), { kind: "invoice", ids: [id(30)] })).incomplete).toBe(true);
    const noJob = inventory(true);noJob.subscription_proration_card_jobs = [];
    expect((await prorationFinancialWitness(reader(noJob), { kind: "invoice", ids: [id(30)] })).incomplete).toBe(true);
  });
  it("refuses contradictory payment/invoice/proration proof and mutually substituted finish/stop", async () => {
    const original = inventory();original.subscription_proration_payment_protocols![0]!.valid = false;
    expect((await prorationFinancialWitness(reader(original), { kind: "invoice", ids: [id(30)] })).incomplete).toBe(true);
    const contradictory = inventory();contradictory.subscription_proration_card_read_finishes = [{ ...row(80, { ...cardParent, readId: id(80), paymentId: id(60) }), valid: false }];
    await prorationFinancialWitness(reader(contradictory, (table, query) => {
      if (table === "subscription_proration_card_read_finishes") expect(query).toContain('from "subscription_proration_card_read_stops" other_receipt where other_receipt.read_id=r.read_id');
    }), { kind: "invoice", ids: [id(30)] }).then(result => expect(result.incomplete).toBe(true));
  });
  it("retains full private-row hash differences without projecting signed bodies or caller secrets", async () => {
    const original = inventory();original.subscription_proration_card_reads![0]!.privateBody = "fictional-private-read-signature-nonce-caller-body";
    const first = await prorationFinancialWitness(reader(original), { kind: "invoice", ids: [id(30)] });
    original.subscription_proration_card_reads![0]!.fingerprint = "b".repeat(64);
    const second = await prorationFinancialWitness(reader(original), { kind: "invoice", ids: [id(30)] });
    expect(first.incomplete).toBe(false);expect(second.incomplete).toBe(false);expect(first.entries).not.toEqual(second.entries);
    expect(JSON.stringify(first)).not.toContain("fictional-private-read-signature-nonce-caller-body");
    expect(first.entries.find(entry => entry.table === "subscription_proration_card_reads")?.id).toBe(id(80));
  });
  it("refuses per-card and original17-plus-card combined overflow without a partial witness", async () => {
    const many = inventory();many.subscription_proration_payment_protocols = Array.from({ length: 5001 }, (_, index) => row(index + 100, { ...cardParent, paymentId: id(index + 100) }));
    expect(await prorationFinancialWitness(reader(many), { kind: "invoice", ids: [id(30)] })).toMatchObject({ incomplete: true, entries: [] });
    const combined = inventory();combined.subscription_prorations = Array.from({ length: 5000 }, (_, index) => row(index + 1, { ...parent().parents, prorationId: id(index + 1), targetInvoiceId: index === 0 ? id(30) : null }));
    expect(await prorationFinancialWitness(reader(combined), { kind: "subscription", ids: [id(10)] })).toMatchObject({ incomplete: true, entries: [] });
  });
});
