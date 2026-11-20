// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C5.19/C12.38: the same recovery permissions govern UI, HTTP and MCP.
import { beforeAll, describe, expect, it } from "vitest";
import { ready } from "@/core/runtime";
import { getExternalService, getService } from "@/core/service";
import { buildOpenApi } from "@/core/api/openapi";
import { publicRefundState } from "@/modules/invoicing/merchant-refund-bank-state-service";
describe("original legacy recovery contract", () => {
  beforeAll(ready, 120000);
  it.each(["invoicing.reviewLegacyBankReaderStopped", "invoicing.replaceLegacyReturnedBankRefund"])("keeps %s a fresh signed-in human money action", name => {
    const service = getExternalService(name); expect(service.def.permission).toBe("scoped"); expect(service.def.stepUp).toBe(true);
    expect(service.def.agentCallable).toBe(false); expect(service.def.writeClass).toBe("money");
  });
  it("exposes the read-only provider recovery parent without exporting raw claim or finish phases", () => {
    expect(getExternalService("invoicing.recoverLegacyBankRefund").def.stepUp).toBe(true);
    for (const name of ["invoicing.prepareLegacyBankRead", "invoicing.recordLegacyBankReadFact", "invoicing.finishLegacyBankRead", "invoicing.claimLegacyBankReplacement", "invoicing.legacyBankCurrentReadFamily", "invoicing.legacyBankReplacementPlan", "invoicing.legacyBankReplacementOutcome", "invoicing.legacyBankReaderRecoveryPlan"]) {
      expect(getService(name)?.def.external).toBe(false); expect(() => getExternalService(name)).toThrow();
    }
  });
  it("does not accept a fabricated wrapper outcome or provider result in the public hosting-stop input", () => {
    const doc = JSON.stringify(buildOpenApi({ origin: "https://example.test", title: "Synthetic legacy recovery contract", version: "test" }));
    expect(doc).toContain("invoicing.reviewLegacyBankReaderStopped");
    const service = getExternalService("invoicing.reviewLegacyBankReaderStopped");
    expect(service.def.input.safeParse({ outcome: "returned", providerStatus: "succeeded" }).success).toBe(false);
  });
  it("keeps provider and read-caller evidence outside the customer refund projection", () => {
    expect(Object.keys(publicRefundState.shape).some(key => /provider|caller|digest|receipt|readId/i.test(key))).toBe(false);
  });
});
