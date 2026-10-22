// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { safeCustomerReturnPath } from "@/core/portal/return-path";
import { safeLocalPath } from "@/core/http/local-path";
describe("customer sign-in return path",()=>{
  it("keeps local customer journeys and their selections",()=>{
    expect(safeCustomerReturnPath("/book?service=portrait&date=2026-10-14")).toBe("/book?service=portrait&date=2026-10-14");
    expect(safeCustomerReturnPath("/fr/portal/invoices/123")).toBe("/fr/portal/invoices/123");
  });
  it.each(["https://evil.test", "//evil.test", "/admin", "/portal/../../admin", "/portal/%2e%2e/admin", "/portal\\evil", "/portal\nlocation: evil", undefined])("refuses external or non-customer destination %s",value=>expect(safeCustomerReturnPath(value)).toBe("/portal"));
});

// C11.10: the step-up, security-action and theme redirects share this check.
describe("local redirect path", () => {
  it("keeps ordinary paths with their query and fragment", () => {
    expect(safeLocalPath("/admin/settings?tab=mail#smtp", "/admin")).toBe("/admin/settings?tab=mail#smtp");
    expect(safeLocalPath("/", "/admin")).toBe("/");
  });
  it.each([
    "/\\evil.test",
    "/\\/evil.test",
    "/%5Cevil.test",
    "/%2F%2Fevil.test",
    "//evil.test",
    "/\t/evil.test",
    "/\n/evil.test",
    "https://evil.test",
    "javascript:alert(1)",
    "evil.test",
    "",
    undefined,
    ["/admin"],
  ])("refuses %j", (value) => expect(safeLocalPath(value, "/admin")).toBe("/admin"));
});
