// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C1.08/C12.38: PREPARED/UNRUN complete subject-family boundary controls.
import { describe, expect, it } from "vitest";
import { assertFinancialExportBound } from "@/modules/invoicing/financial-export-bound";

describe("complete original financial subject export", () => {
  const rows = (count: number) => Array.from({ length: count }, (_, id) => ({ id }));
  it("accepts exactly 5000 actual rows across invoices, cash and noncash histories", () => {
    expect(() => assertFinancialExportBound(
      { invoice: rows(1), lines: rows(2), payments: rows(1) },
      { merchantRecovery: { originalCash: { feedback: rows(997) } }, credit: { funding: rows(1999) }, fees: { duties: rows(2000) } },
    )).not.toThrow();
  });
  it("refuses a combined overflow even when every independent helper is bounded", () => {
    expect(() => assertFinancialExportBound({ recovery: { facts: rows(2000) } }, { credit: { reservations: rows(2000) } },
      { fees: { duties: rows(1001) } })).toThrow(expect.objectContaining({ code: "conflict" }));
  });
  it("counts exported rows without treating embedded receipt JSON as another family", () => {
    expect(() => assertFinancialExportBound({ receipts: [{ evidence: { facts: rows(6000) } }] })).not.toThrow();
    expect(() => assertFinancialExportBound({ unexpectedScalar: 0 })).toThrow(expect.objectContaining({ code: "conflict" }));
  });
});
