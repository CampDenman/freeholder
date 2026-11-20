// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C1.08/C12.38: PREPARED/UNRUN generated SQL against a synthetic read driver.
// No service context, database acceptance or financial receipt is fabricated.
import { drizzle } from "drizzle-orm/pg-proxy";
import { describe, expect, it } from "vitest";
import type { Tx } from "@/core/service";
import { prorationMoneyWitnesses } from "@/modules/invoicing/proration-money-witnesses";

describe("original credit target history query adapter", () => {
  const targetInvoice = "10000000-0000-4000-8000-000000000001", sourceInvoice = "10000000-0000-4000-8000-000000000002";
  const reservation = "20000000-0000-4000-8000-000000000001", funding = "30000000-0000-4000-8000-000000000001";
  it("discovers an unapplied reservation through the exact accepted target and retains its release history", async () => {
    let targetQueries = 0;
    const reader = drizzle(async (query, parameters) => {
      if (query.includes('from "invoice_credit_reservations"') && query.includes('inner join "invoices"')) {
        targetQueries++;
        expect(query).toContain('"invoices"."source_type" =');
        expect(query).toContain('"invoices"."source_id" = "invoice_credit_reservations"."target_source_id"');
        expect(query).toContain('inner join "subscription_prorations"');
        expect(query).toContain('"subscription_prorations"."debit_invoice_id" = "invoices"."id"');
        expect(query).toContain('"subscription_prorations"."subscription_id"::text');
        expect(query).toContain("':proration:'");
        expect(query).toContain('"subscription_prorations"."id"::text');
        expect(parameters).toContain("subscription");expect(parameters).toContain(targetInvoice);
        return { rows: [[reservation]] };
      }
      if (query.includes('from "invoice_credit_funding"')) {
        expect(parameters).toContain(reservation);
        return { rows: [[funding, sourceInvoice, "funding-sha"]] };
      }
      if (query.includes('from "invoice_credit_reservations"')) return { rows: [[reservation, funding, "reservation-sha"]] };
      if (query.includes('from "invoice_credit_releases"')) return { rows: [[reservation, "release-sha"]] };
      return { rows: [] };
    });
    const history = await prorationMoneyWitnesses(reader as unknown as Tx, [targetInvoice]);
    expect(targetQueries).toBe(1);expect(history.incomplete).toBe(false);
    expect(history.funding).toEqual([{ id: funding, invoiceId: sourceInvoice, fingerprint: "funding-sha" }]);
    expect(history.reservations).toHaveLength(1);expect(history.releases).toHaveLength(1);expect(history.applications).toEqual([]);
  });
  it("refuses incomplete target discovery rather than treating a truncated set as no reservation", async () => {
    const reader = drizzle(async query => ({ rows: query.includes('inner join "invoices"') ? Array.from({ length: 5001 }, (_, index) => [`target-${index}`]) : [] }));
    expect((await prorationMoneyWitnesses(reader as unknown as Tx, [targetInvoice])).incomplete).toBe(true);
  });
});
