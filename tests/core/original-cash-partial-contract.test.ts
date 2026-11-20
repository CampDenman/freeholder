// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: PREPARED/UNRUN shared human authority and private target phases.
import { beforeAll, describe, expect, it } from "vitest";
import { ready } from "@/core/runtime";
import { getExternalService, getService } from "@/core/service";
import { ORIGINAL_PARTIAL_CASH_CONFIRMATION, ORIGINAL_UNASSIGNED_CASH_CONFIRMATION } from "@/modules/invoicing/original-cash-partial-contract";
const uuid = "00000000-0000-4000-8000-000000000001";
describe("original partial cash contract", () => {
  beforeAll(ready, 120000);
  it.each(["reconcileOriginalPartialCashReturn", "reviewOriginalUnassignedCash"])("keeps %s scoped and freshly confirmed by a person", name => {
    const service = getExternalService(`invoicing.${name}`);
    expect(service.def).toMatchObject({ permission: "scoped", stepUp: true, agentCallable: false, writeClass: "money" });
  });
  it("derives money from an exact original payment and refuses supplied outcomes", () => {
    const service = getExternalService("invoicing.reconcileOriginalPartialCashReturn"), value = { paymentId: uuid, confirmation: ORIGINAL_PARTIAL_CASH_CONFIRMATION };
    expect(service.def.input.safeParse(value).success).toBe(true);
    expect(service.def.input.safeParse({ ...value, amountMinor: 1, status: "succeeded" }).success).toBe(false);
    expect(service.def.input.safeParse({ ...value, confirmation: "yes" }).success).toBe(false);
  });
  it("requires the actual server raw fact and read, without accepting a resource asserted by a caller", () => {
    const service = getExternalService("invoicing.reviewOriginalUnassignedCash"), value = { recoveryId: uuid, operationId: uuid, rawFactId: uuid, confirmation: ORIGINAL_UNASSIGNED_CASH_CONFIRMATION };
    expect(service.def.input.safeParse(value).success).toBe(true);
    expect(service.def.input.safeParse({ ...value, providerRef: "re_equal", amountMinor: 1 }).success).toBe(false);
    expect(service.def.input.safeParse({ recoveryId: uuid, operationId: uuid, confirmation: ORIGINAL_UNASSIGNED_CASH_CONFIRMATION }).success).toBe(false);
  });
  it.each(["retainOriginalPartialCashTarget", "claimOriginalPartialCashAuxiliary", "finalizeOriginalPartialCashTarget", "originalPartialCashEntry", "originalPartialRefundInventory"])("keeps %s private", name => {
    const service = getService(`invoicing.${name}`); expect(service.def.external).toBe(false); expect(service.def.permission).toBe("system"); expect(() => getExternalService(service.def.name)).toThrow();
  });
});
