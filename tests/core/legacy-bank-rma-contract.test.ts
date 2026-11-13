// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C5.19/C12.38: actual original return recovery shares HTTP/MCP/UI permissions.
import { beforeAll, describe, expect, it } from "vitest";
import { ready } from "@/core/runtime";
import { getExternalService, getService } from "@/core/service";
import { buildOpenApi } from "@/core/api/openapi";
import { RETURN_BANK_REPLACEMENT_CONFIRMATION } from "@/modules/catalog/legacy-return-bank-recovery";
describe("original return bank recovery contract", () => {
  beforeAll(ready, 120000);
  it.each(["catalog.recoverReturnBankRefunds", "catalog.replaceReturnBankRefunds"])("keeps %s scoped, freshly verified and a shared money operation", name => {
    const service = getExternalService(name); expect(service.def.permission).toBe("scoped"); expect(service.def.stepUp).toBe(true); expect(service.def.writeClass).toBe("money");
  });
  it("requires exact human replacement confirmation and accepts no supplied provider/credit outcome", () => {
    const service = getExternalService("catalog.replaceReturnBankRefunds"); expect(service.def.agentCallable).toBe(false);
    const id = "00000000-0000-4000-8000-000000000001";
    expect(service.def.input.safeParse({ id, confirmation: RETURN_BANK_REPLACEMENT_CONFIRMATION }).success).toBe(true);
    expect(service.def.input.safeParse({ id, confirmation: "replace" }).success).toBe(false);
    expect(service.def.input.safeParse({ id, confirmation: RETURN_BANK_REPLACEMENT_CONFIRMATION, status: "succeeded", creditNoteId: id }).success).toBe(false);
  });
  it("keeps actual credit/allocation ownership, raw signed feedback and planning private to the shared services", () => {
    for (const name of ["catalog.legacyReturnBankRefundOwner", "catalog.legacyReturnBankPlan", "invoicing.retainLegacyBankFeedback"]) {
      const service = getService(name); expect(service.def.external).toBe(false); expect(service.def.permission).toBe("system"); expect(() => getExternalService(name)).toThrow();
    }
  });
  it("publishes both owner recovery parents in the generated HTTP API", () => {
    const doc = JSON.stringify(buildOpenApi({ origin: "https://example.test", title: "Synthetic original RMA recovery", version: "test" }));
    expect(doc).toContain("catalog.recoverReturnBankRefunds"); expect(doc).toContain("catalog.replaceReturnBankRefunds");
  });
});
