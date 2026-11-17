// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { merchantTaxDigest } from "@/modules/invoicing/merchant-tax-store";

describe("canonical key-index ordering", () => {
  it("preserves values and canonical bytes across key insertion order", () => {
    const first = { z: [1, undefined, { é: true, a: null }], a: "value" };
    const second = { a: "value", z: [1, undefined, { a: null, é: true }] };
    expect(merchantTaxDigest(first)).toBe(merchantTaxDigest(second));
    expect(merchantTaxDigest({ ...first, a: "changed" })).not.toBe(merchantTaxDigest(first));
  });

  it("evaluates each getter once and preserves sparse arrays", () => {
    let reads = 0;
    const value = { get current() { reads++; return reads; }, sparse: [, 1] };
    expect(merchantTaxDigest(value)).toBe(merchantTaxDigest({ sparse: [, 1], current: 1 }));
    expect(reads).toBe(1);
  });
});
