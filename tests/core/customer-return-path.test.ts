// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { safeCustomerReturnPath } from "@/core/portal/return-path";
describe("customer sign-in return path",()=>{
  it("keeps local customer journeys and their selections",()=>{
    expect(safeCustomerReturnPath("/book?service=portrait&date=2026-10-14")).toBe("/book?service=portrait&date=2026-10-14");
    expect(safeCustomerReturnPath("/fr/portal/invoices/123")).toBe("/fr/portal/invoices/123");
  });
  it.each(["https://evil.test", "//evil.test", "/admin", "/portal/../../admin", "/portal/%2e%2e/admin", "/portal\\evil", "/portal\nlocation: evil", undefined])("refuses external or non-customer destination %s",value=>expect(safeCustomerReturnPath(value)).toBe("/portal"));
});
