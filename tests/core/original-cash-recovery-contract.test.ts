// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: UI, HTTP and MCP share exact human money authority and private facts.
import { beforeAll, describe, expect, it } from "vitest";
import { ready } from "@/core/runtime";
import { getExternalService, getService } from "@/core/service";
import { ORIGINAL_CASH_RETURN_CONFIRMATION } from "@/modules/invoicing/original-cash-recovery-proof";
describe("original cash-return service contract", () => {
  beforeAll(ready, 120000);
  it.each(["invoicing.returnOriginalCash", "invoicing.reviewOriginalCashCallerStopped", "invoicing.reviewOriginalCashLegacyFeeStopped"])("keeps %s scoped, freshly verified and human only", name => {
    const service = getExternalService(name); expect(service.def.permission).toBe("scoped"); expect(service.def.stepUp).toBe(true); expect(service.def.agentCallable).toBe(false); expect(service.def.writeClass).toBe("money");
  });
  it("exposes GET-only recovery to the same scoped callers without accepting supplied money or bank outcomes", () => {
    const service = getExternalService("invoicing.inspectOriginalCashReturn"); expect(service.def.permission).toBe("scoped"); expect(service.def.stepUp).toBe(true);
    expect(service.def.input.safeParse({ recoveryId: "00000000-0000-4000-8000-000000000001", status: "succeeded" }).success).toBe(false);
  });
  it("accepts an exact receipt-only source and confirmation while refusing fabricated payment, amount or status", () => {
    const service = getExternalService("invoicing.returnOriginalCash"), uuid = "00000000-0000-4000-8000-000000000001";
    const value = { source: { kind: "subscription", receiptId: uuid, observationId: uuid }, confirmation: ORIGINAL_CASH_RETURN_CONFIRMATION };
    expect(service.def.input.safeParse(value).success).toBe(true);
    expect(service.def.input.safeParse({ ...value, amountMinor: 100, status: "succeeded" }).success).toBe(false);
    expect(service.def.input.safeParse({ ...value, confirmation: "yes" }).success).toBe(false);
  });
  it.each(["claimOriginalCashRecovery", "claimOriginalCashInspection", "recordOriginalCashFact", "claimOriginalCashAuxiliary", "claimOriginalUnappliedCashRefund", "originalCashRecoveryPhase", "checkOriginalCashInventory", "finalizeOriginalCashRecovery"])("keeps the actual %s phase private and system-only", name => {
    const service = getService(`invoicing.${name}`); expect(service.def.external).toBe(false); expect(service.def.permission).toBe("system"); expect(() => getExternalService(service.def.name)).toThrow();
  });
});
