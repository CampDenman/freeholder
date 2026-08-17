// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Display helpers and catalog keys for the invoice/tax admin workspace.

import { describe, expect, it } from "vitest";
import { catalogKeys } from "@/core/i18n";
import { formatPpm, invoiceTone, quantityFromMicros } from "../../app/(admin)/admin/invoices/format";

describe("invoice admin display helpers", () => {
  it("formats millionths without floating-point money math", () => {
    expect(quantityFromMicros(1_000_000)).toBe("1");
    expect(quantityFromMicros(2_500_000)).toBe("2.5");
    expect(quantityFromMicros(1)).toBe("0.000001");
  });

  it("formats parts-per-million rates as percents", () => {
    expect(formatPpm(50_000)).toBe("5%");
    expect(formatPpm(99_750)).toBe("9.975%");
    expect(formatPpm(72_500)).toBe("7.25%");
  });

  it("uses warning and danger tones for unpaid and void invoices", () => {
    expect(invoiceTone("paid")).toBe("success");
    expect(invoiceTone("draft")).toBe("warning");
    expect(invoiceTone("overdue")).toBe("danger");
    expect(invoiceTone("void")).toBe("danger");
    expect(invoiceTone("sent")).toBe("neutral");
  });
});

describe("invoice and tax catalogs", () => {
  it("covers the operator workspace strings in every locale", () => {
    for (const locale of ["en", "fr", "es"] as const) {
      const keys = catalogKeys(locale);
      expect(keys).toContain("invoices.title");
      expect(keys).toContain("invoices.create");
      expect(keys).toContain("tax.install");
      expect(keys).toContain("tax.registration.acknowledge");
    }
  });
});
