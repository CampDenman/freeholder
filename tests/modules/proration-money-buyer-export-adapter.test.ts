// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C1.08/C12.38: PREPARED/UNRUN actual projection SQL with synthetic read rows.
import { drizzle } from "drizzle-orm/pg-proxy";
import { describe, expect, it } from "vitest";
import type { Tx } from "@/core/service";
import { exportProrationMoney } from "@/modules/invoicing/proration-money-export";

describe("buyer original consideration export adapter", () => {
  it("retains principal and fee receipt identities without merchant fee amounts or private evidence", async () => {
    const invoice = "10000000-0000-4000-8000-000000000001", payment = "20000000-0000-4000-8000-000000000001";
    const fee = "30000000-0000-4000-8000-000000000001", at = "2026-11-13 00:00:00+00";
    let projectedPayments = 0, projectedFees = 0;
    const reader = drizzle(async query => {
      if (query.includes('from "commercial_payment_attestations"')) {
        if (query.includes("sha256")) return { rows: [[payment, invoice, "private-full-row-sha"]] };
        projectedPayments++;expect(query).not.toContain('"fee_owed_minor"');
        expect(query).not.toContain('"recorded_by"');expect(query).not.toContain('"evidence_digest"');
        return { rows: [[payment, invoice, 1200, "CAD", at]] };
      }
      if (query.includes('from "commercial_fee_attestations"')) {
        if (query.includes("sha256")) return { rows: [[fee, payment, "private-full-fee-row-sha"]] };
        projectedFees++;expect(query).not.toContain('"amount_minor"');
        expect(query).not.toContain('"recorded_by"');expect(query).not.toContain('"evidence_digest"');
        return { rows: [[fee, payment, null, "remitted", at]] };
      }
      return { rows: [] };
    });
    const exported = await exportProrationMoney(reader as unknown as Tx, [invoice]);
    expect(projectedPayments).toBe(1);expect(projectedFees).toBe(1);
    expect(exported.externalPayments[0]).toMatchObject({ paymentId: payment, invoiceId: invoice, amountMinor: 1200, currency: "CAD" });
    expect(exported.externalPayments[0]).not.toHaveProperty("originalFeeOwedMinor");
    expect(exported.externalFees[0]).toMatchObject({ receiptId: fee, paymentId: payment, direction: "remitted" });
    expect(exported.externalFees[0]).not.toHaveProperty("amountMinor");
    expect(JSON.stringify(exported)).not.toContain("private-full-row-sha");expect(JSON.stringify(exported)).not.toContain("private-full-fee-row-sha");
  });
});
