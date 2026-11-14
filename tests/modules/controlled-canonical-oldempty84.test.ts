// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C12.38/C1.08. PREPARED/UNRUN: actual birth namespace and old read surface.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { controlledCanonicalLegacyEmpty } from "@/modules/invoicing/controlled-canonical-bank-policy";
const empty = { paymentMethod: "saved_method", paymentIdempotencyKey: "original-checkout-key", receiptIds: [], controlledReceiptIds: [], routes: [] };
const source = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
describe("controlled principal legacy empty surface", () => {
  it("keeps ordinary actual empty source and a real attempt route outside future-link reads", () => {
    expect(controlledCanonicalLegacyEmpty(empty)).toBe(true);
    expect(controlledCanonicalLegacyEmpty({ ...empty, routes: [{ originKind: "attempt", receiptId: null }] })).toBe(true);
  });
  it("never treats zero receipts as proof that a reserved controlled birth is legacy", () => {
    expect(controlledCanonicalLegacyEmpty({ ...empty, paymentIdempotencyKey: "controlled-receipt:actual-collection:actual-receipt" })).toBe(false);
  });
  it("keeps actual known controlled receipt and immutable schedule alias on the full reader", () => {
    expect(controlledCanonicalLegacyEmpty({ ...empty, paymentMethod: "provider_schedule", receiptIds: ["receipt"], controlledReceiptIds: ["receipt"],
      routes: [{ originKind: "provider_schedule", receiptId: "receipt" }] })).toBe(false);
  });
  it("does not skip full membership reads merely because an actual receipt namespace is legacy", () => {
    expect(controlledCanonicalLegacyEmpty({ ...empty, receiptIds: ["old-receipt"] })).toBe(false);
  });
  it.each(["missing_route", "missing_receipt", "foreign_alias"] as const)("refuses actual %s instead of an empty fallback", kind => {
    const input = { ...empty, paymentMethod: "provider_schedule", receiptIds: kind === "foreign_alias" ? ["real-receipt"] : [],
      routes: kind === "missing_route" ? [] : [{ originKind: "provider_schedule" as const, receiptId: kind === "missing_receipt" ? null : "foreign-receipt" }] };
    expect(() => controlledCanonicalLegacyEmpty(input)).toThrow();
  });
  it("refuses an impossible attempt alias and a substituted method without using a prefix as ownership", () => {
    expect(() => controlledCanonicalLegacyEmpty({ ...empty, receiptIds: ["receipt"], routes: [{ originKind: "attempt", receiptId: "receipt" }] })).toThrow();
    expect(() => controlledCanonicalLegacyEmpty({ ...empty, paymentMethod: "bank_transfer", routes: [{ originKind: "attempt", receiptId: null }] })).toThrow();
  });
  it("refuses duplicated routes/physical receipts and a controlled ID absent from actual selected receipts", () => {
    expect(() => controlledCanonicalLegacyEmpty({ ...empty, routes: [{ originKind: "attempt", receiptId: null }, { originKind: "attempt", receiptId: null }] })).toThrow();
    expect(() => controlledCanonicalLegacyEmpty({ ...empty, receiptIds: ["receipt", "receipt"] })).toThrow();
    expect(() => controlledCanonicalLegacyEmpty({ ...empty, controlledReceiptIds: ["not-selected"] })).toThrow();
  });
  it("binds the negative selector to BOTH actual immutable receipt birth protocols and the actual payment INSERT link", () => {
    for (const path of ["deploy/controlled-cash-application-protocol84.fragment.sql", "deploy/controlled-cash-atomic-fee84.fragment.sql"]) {
      expect(source(path)).toContain("NEW.payment_idempotency_key IS DISTINCT FROM 'controlled-receipt:'||admitted_batch.collection_id::text||':'||NEW.receipt_id::text");
    }
    const birth = source("deploy/controlled-cash-application-stages84.fragment.sql");
    expect(birth).toContain("WHERE payment_idempotency_key=NEW.idempotency_key");
    expect(birth).toContain("PERFORM freeholder_controlled_cash_validate_birth(batch_record.id,NEW.id)");
    const original = source("deploy/controlled-cash-application-protocol84.fragment.sql");
    expect(original).toContain("actual_payment.idempotency_key IS DISTINCT FROM receipt_proof.payment_idempotency_key");
    expect(original).toContain("TG_OP<>'INSERT' OR pg_trigger_depth()<2");
  });
  it("returns genuine empty legacy before the future query and preserves independent same-transaction refusal", () => {
    const reader = source("src/modules/invoicing/controlled-canonical-bank-principal.ts");
    const early = reader.indexOf("if (controlledCanonicalLegacyEmpty("), future = reader.indexOf("from(controlledCashApplicationLinks)");
    expect(early).toBeGreaterThan(0); expect(future).toBeGreaterThan(early);
    expect(reader).toContain('if(payment.idempotencyKey.startsWith("controlled-receipt:"))refuse()');
    expect(reader).toContain("transaction[0]?.transaction_id===batch.admissionTransactionId)refuse()");
    expect(reader).not.toContain("readControlledCashApplicationStage");
  });
});
