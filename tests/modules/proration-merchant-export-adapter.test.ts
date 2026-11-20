// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C1.08/C9.33/C12.38: PREPARED/UNRUN actual adapter SQL, synthetic reads only.
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { Tx } from "@/core/service";
import { exportProrationMerchantHistory } from "@/modules/invoicing/proration-merchant-export";
import type { ProrationFinancialParents, ProrationFinancialTable } from "@/modules/invoicing/proration-financial-witness";

const id = (n: number) => `20000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
type Row = { id: string; parents: ProrationFinancialParents; fingerprint: string; valid: boolean };
type Inventory = Partial<Record<ProrationFinancialTable, Row[]>>;
type Projected = { id: string; fingerprint: string; record: Record<string, unknown> };
const row = (n: number, parents: ProrationFinancialParents): Row => ({ id: id(n), parents: { profileId: id(20), ...parents }, fingerprint: "a".repeat(64), valid: true });
const accepted = { prorationId: id(1), subscriptionId: id(10), sourceInvoiceId: id(31), targetInvoiceId: id(30), creditNoteId: id(40) };
const target = { prorationId: id(1), subscriptionId: id(10), invoiceId: id(30) };
function inventory(): Inventory {
  const reservation = { fundingId: id(50), sourceProrationId: id(1), targetProrationId: id(1), subscriptionId: id(10), sourceInvoiceId: id(31), targetInvoiceId: id(30), creditNoteId: id(40) };
  return {
    subscription_prorations: [row(1, accepted)],
    commercial_payment_attestations: [row(60, { paymentId: id(60), invoiceId: id(31) }), row(61, { paymentId: id(61), invoiceId: id(30) })],
    commercial_refund_attestations: [row(90, { refundId: id(90), paymentId: id(60), invoiceId: id(31) })],
    commercial_fee_attestations: [row(101, { paymentId: id(60), invoiceId: id(31), originalRemittanceId: null })],
    invoice_credit_funding: [row(50, { fundingId: id(50), sourceProrationId: id(1), subscriptionId: id(10), sourceInvoiceId: id(31), sourcePaymentId: id(60), sourceApplicationId: null, creditNoteId: id(40), creditNoteLineId: id(41) })],
    invoice_credit_reservations: [row(70, { ...reservation, reservationId: id(70) }), row(71, { ...reservation, reservationId: id(71) })],
    invoice_credit_applications: [row(70, { ...reservation, applicationId: id(70), reservationId: id(70) })],
    invoice_credit_releases: [row(71, { reservationId: id(71), fundingId: id(50), sourceProrationId: id(1), sourceInvoiceId: id(31), creditNoteId: id(40) })],
    subscription_proration_principal: [row(81, { prorationId: id(1), subscriptionId: id(10), sourcePaymentId: id(60), sourceApplicationId: null })],
    subscription_proration_credit_uses: [row(80, { prorationId: id(1), subscriptionId: id(10), creditNoteId: id(40) })],
    agreement_fee_duties: [row(30, target)],
    agreement_fee_credit_assignments: [row(70, { ...target, applicationId: id(70) })],
    agreement_fee_cash_assignments: [row(61, { ...target, paymentId: id(61) })],
    agreement_fee_eligibility: [row(30, target)],
    agreement_fee_remittances: [row(102, { ...target, originalRemittanceId: null })],
    subscription_proration_cash_confirmations: [row(61, { ...target, paymentId: id(61), externalAttestationId: id(61), providerObservationId: null })],
    subscription_proration_credit_confirmations: [row(70, { ...target, applicationId: id(70) })],
    subscription_proration_payment_protocols: [row(61, { ...target, paymentId: id(61) })],
    subscription_proration_card_mandates: [row(1, { ...target, paymentMethodId: id(104) })],
    subscription_proration_card_attempts: [row(61, { ...target, paymentId: id(61), paymentMethodId: id(104) })],
    subscription_proration_card_jobs: [row(105, { ...target, jobId: id(105) })],
    subscription_proration_card_reads: [row(106, { ...target, readId: id(106), paymentId: id(61) }), row(107, { ...target, readId: id(107), paymentId: id(61) })],
    subscription_proration_card_read_finishes: [row(106, { ...target, readId: id(106), paymentId: id(61) })],
    subscription_proration_card_read_stops: [row(107, { ...target, readId: id(107), paymentId: id(61) })],
  };
}
// Independent scalar allowlist: expanding a product projection needs a review
// here, rather than fabricating arbitrary values for unknown SQL parameters.
const instant = "2026-11-13T12:00:00.000Z";
const scalar: Record<string, string | number | boolean | null> = {
  amountMinor: 1000, requestedAmountMinor: 1000, currency: "CAD", feeOwedMinor: 45, profileVersion: 2, status: "succeeded", noteStatus: "issued",
  direction: "remitted", feeObligationMinor: 45, feeProvenCollectedMinor: 30, feeCollectionState: "owed", feeUnexpected: false,
  billingMode: "manual", state: "applied", debitNetMinor: 900, debitTaxMinor: 100, creditNetMinor: 450, creditTaxMinor: 50,
  debitFeeObligationMinor: 45, creditFeeObligationMinor: 22, appliedFeeObligationMinor: 20, appliedFeeProvenCollectedMinor: 15,
  totalMinor: 1000, targetFeeMinor: 45, creditedMinor: 500, carriedFeeMinor: 20, cashPrincipalMinor: 500, cashFeeTargetMinor: 25, expectedReceivableMinor: 30,
  provenCollectedMinor: 15, origin: "recorded_external", providerApiVersion: "2026-02-25.clover", outcome: "returned",
  createdAt: instant, processedAt: instant, failedAt: null, appliedAt: instant, releasedAt: null, paidAt: instant, retainedAt: instant,
  effectiveAt: instant, originalPeriodStart: instant, originalPeriodEnd: instant, originalTrialEndsAt: null,
  proposedPeriodStart: instant, proposedPeriodEnd: instant, cancelledAt: null, finishedAt: instant, stopReviewedAt: null,
};
interface Hooks {
  inspect?: (table: ProrationFinancialTable, query: string, parameters: unknown[], projection: boolean) => void;
  project?: (table: ProrationFinancialTable, rows: Projected[]) => Projected[];
  afterProjection?: (table: ProrationFinancialTable) => void;
}
function reader(original: Inventory, hooks: Hooks = {}) {
  const dialect = new PgDialect(), projected: ProrationFinancialTable[] = [];
  const tx = { execute: async (statement: SQL) => {
    const { sql: query, params } = dialect.sqlToQuery(statement), match = query.match(/\b(valid|record)\s+from\s+"?([a-z_]+)"? r\b/);
    if (!match) throw new Error("The actual merchant export lost its bounded physical-table SELECT.");
    const table = match[2] as ProrationFinancialTable, projection = match[1] === "record";
    expect(query).toContain("sha256(convert_to(to_jsonb(r)::text");hooks.inspect?.(table, query, params, projection);
    if (!projection) { expect(params).toContain(5001);return original[table] ?? []; }
    expect(query).toContain("limit 5001");expect(query).toContain(" in (");
    const keys = params.filter((value): value is string => typeof value === "string" && Object.hasOwn(scalar, value));
    // Every non-UUID parameter is an explicit output key. No opaque JSON,
    // actor, account or credential key can be silently added by this driver.
    expect(params.filter(value => typeof value !== "string" || !/^20000000-0000-4000-8000-\d{12}$/.test(value))).toEqual(keys);
    const rows = (original[table] ?? []).map(source => {
      expect(params).toContain(source.id);
      return { id: source.id, fingerprint: source.fingerprint, record: Object.fromEntries(keys.map(key => [key, scalar[key]])) };
    });
    projected.push(table);const result = hooks.project?.(table, rows) ?? rows;hooks.afterProjection?.(table);return result;
  } } as unknown as Tx;
  return { tx, projected };
}

describe("authorized original merchant proration financial export", () => {
  it("projects all24 families with exact identities, merchant commission amounts and source/target credit lineage", async () => {
    const source = inventory(), mock = reader(source), result = await exportProrationMerchantHistory(mock.tx, [id(20)]);
    expect(new Set(result.entries.map(entry => entry.table)).size).toBe(24);
    expect(result.entries).toHaveLength(Object.values(source).reduce((count, rows) => count + rows.length, 0));
    expect(result.entries.find(entry => entry.table === "invoice_credit_funding")).toMatchObject({ parents: { sourceInvoiceId: id(31), sourcePaymentId: id(60), creditNoteLineId: id(41) }, record: { amountMinor: 1000, currency: "CAD", feeObligationMinor: 45 } });
    expect(result.entries.find(entry => entry.table === "invoice_credit_applications")).toMatchObject({ parents: { targetInvoiceId: id(30), reservationId: id(70) } });
    expect(result.entries.find(entry => entry.table === "agreement_fee_remittances")?.record).toEqual({ direction: "remitted", amountMinor: 1000, currency: "CAD", createdAt: instant });
    expect(result.entries.find(entry => entry.table === "commercial_payment_attestations")?.record).toMatchObject({ feeOwedMinor: 45, status: "succeeded", processedAt: instant });
    expect(result.entries.find(entry => entry.table === "subscription_proration_card_jobs")?.id).toBe(id(105));
    expect(result.entries.find(entry => entry.table === "subscription_proration_cash_confirmations")?.record).toEqual({ retainedAt: instant, amountMinor: 1000, currency: "CAD" });
    expect(result.entries.find(entry => entry.table === "subscription_proration_credit_confirmations")?.record).toEqual({ retainedAt: instant, amountMinor: 1000, currency: "CAD" });
  });
  it("roots selection in frozen profiles and projects only exact adapter-selected IDs on a mixed invoice", async () => {
    const mock = reader(inventory(), { inspect: (table, query, params, projection) => {
      if (!projection && table === "subscription_prorations") { expect(query).toContain('"r"."profile_id" in');expect(params).toContain(id(20)); }
      if (projection) { expect(params).not.toContain(id(21));expect(query).not.toContain("contact_id");expect(query).not.toContain("email"); }
    } });
    await exportProrationMerchantHistory(mock.tx, [id(20)]);
    const foreign = inventory();foreign.commercial_payment_attestations![0]!.parents.profileId = id(21);
    const refused = reader(foreign);await expect(exportProrationMerchantHistory(refused.tx, [id(20)])).rejects.toMatchObject({ code: "conflict" });
    expect(refused.projected).toEqual([]);
    const substituted = reader(inventory(), { project: (_table, rows) => rows.map(value => ({ ...value, id: id(999) })) });
    await expect(exportProrationMerchantHistory(substituted.tx, [id(20)])).rejects.toMatchObject({ code: "conflict" });
  });
  it("does not export opaque snapshots, actors, private bank/caller bodies, queue tasks or buyer destinations", async () => {
    const result = await exportProrationMerchantHistory(reader(inventory(), { inspect: (_table, query, _params, projection) => {
      if (projection) {
        expect(query).not.toMatch(/r\.(?:tax_destination|notice_snapshot|accepted_by|admission|proof|method|original_task|provider_request)\b/);
        expect(query).not.toMatch(/r\.snapshot\s*[,)]/);
      }
    } }).tx, [id(20)]);
    const serialized = JSON.stringify(result);
    for (const forbidden of ["fingerprint", "snapshot", "evidence", "nonce", "signature", "hosting", "taxDestination", "noticeSnapshot", "acceptedBy", "originalTask", "providerRequest", "providerCustomer", "methodToken"]) expect(serialized).not.toContain(forbidden);
    expect(result.entries.find(entry => entry.table === "subscription_proration_card_read_finishes")?.record.outcome).toBe("returned");
  });
  it("refuses missing, duplicated or changed full-row witnesses without substituting safe-projection hashes", async () => {
    for (const project of [(_table: ProrationFinancialTable, rows: Projected[]) => rows.slice(1),
      (_table: ProrationFinancialTable, rows: Projected[]) => rows.map(value => ({ ...value, fingerprint: "b".repeat(64) })),
      (_table: ProrationFinancialTable, rows: Projected[]) => [...rows, ...rows]]) {
      await expect(exportProrationMerchantHistory(reader(inventory(), { project }).tx, [id(20)])).rejects.toMatchObject({ code: "conflict" });
    }
  });
  it("rechecks the entire exact financial inventory after projections and refuses a newly retained child", async () => {
    const original = inventory();let changed = false;
    const mock = reader(original, { afterProjection: table => {
      if (!changed && table === "subscription_prorations") { changed = true;original.commercial_fee_attestations!.push(row(103, { paymentId: id(60), invoiceId: id(31), originalRemittanceId: null })); }
    } });
    await expect(exportProrationMerchantHistory(mock.tx, [id(20)])).rejects.toMatchObject({ code: "conflict" });
  });
  it("shares one5000 budget with the authorized parent's existing actual history and refuses malformed bounds", async () => {
    const source = inventory(), count = Object.values(source).reduce((sum, rows) => sum + rows.length, 0);
    expect((await exportProrationMerchantHistory(reader(source).tx, [id(20)], { existingRows: 5000 - count })).entries).toHaveLength(count);
    const overflow = reader(source);await expect(exportProrationMerchantHistory(overflow.tx, [id(20)], { existingRows: 5001 - count })).rejects.toMatchObject({ code: "conflict" });expect(overflow.projected).toEqual([]);
    for (const existingRows of [-1, 0.5, 5001, Number.MAX_SAFE_INTEGER + 1]) await expect(exportProrationMerchantHistory(reader({}).tx, [], { existingRows })).rejects.toMatchObject({ code: "conflict" });
  });
  it("refuses non-scalar/private expansion, unsafe amounts and missing actual source currency", async () => {
    for (const invalid of [{ amountMinor: { privateBankBody: "fictional-private" } }, { amountMinor: Number.MAX_SAFE_INTEGER + 1 }, { currency: null }, { currency: "cad" }]) {
      const mock = reader(inventory(), { project: (table, rows) => table === "commercial_payment_attestations" ? rows.map(value => ({ ...value, record: { ...value.record, ...invalid } })) : rows });
      await expect(exportProrationMerchantHistory(mock.tx, [id(20)])).rejects.toMatchObject({ code: "conflict" });
    }
    const expanded = reader(inventory(), { project: (_table, rows) => rows.map(value => ({ ...value, record: { ...value.record, privateEvidence: "fictional-private" } })) });
    await expect(exportProrationMerchantHistory(expanded.tx, [id(20)])).rejects.toMatchObject({ code: "conflict" });
  });
});
