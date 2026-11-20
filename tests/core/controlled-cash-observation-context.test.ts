// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// PREPARED/UNRUN. Genuine query composition is required outside these DTO checks.
import { describe,it,expect } from "vitest";
import { controlledCashObservationAuthorityResult } from "@/modules/invoicing/controlled-cash-inspection-observation-context";
import { prepareControlledCashInspection,controlledCashInspectionOutcome,inspectControlledCashReceipt } from "@/modules/invoicing/controlled-cash-inspection-service";
describe("controlled observation capability is separate from financial permission",()=>{
 const actual={allowed:true,revision:"1".repeat(64),causalSourceRevision:"2".repeat(64)};
 it("requires separate full-current and historical-causal revisions",()=>{expect(controlledCashObservationAuthorityResult.safeParse(actual).success).toBe(true);expect(controlledCashObservationAuthorityResult.safeParse({allowed:true,revision:actual.revision}).success).toBe(false);});
 it("does not accept a generic coverage-only ready result as this observation authority",()=>{expect(controlledCashObservationAuthorityResult.safeParse({ready:true,revision:actual.revision}).success).toBe(false);});
 it("refuses forged money/principal authority or an opaque missing causal digest",()=>{expect(controlledCashObservationAuthorityResult.safeParse({...actual,principalSafe:true}).success).toBe(false);expect(controlledCashObservationAuthorityResult.safeParse({...actual,causalSourceRevision:"unknown"}).success).toBe(false);});
 it("keeps SDK claim nonce private and audits only original source IDs",()=>{expect(prepareControlledCashInspection.def.permission).toBe("system");expect(prepareControlledCashInspection.def.external).toBe(false);expect(prepareControlledCashInspection.def.auditInputFields).toEqual(["collectionId","receiptId"]);expect(controlledCashInspectionOutcome.def.external).toBe(false);});
 it("uses the same public shared audited owner operation for actual HTTP/MCP adapters",()=>{expect(inspectControlledCashReceipt.def.permission).toBe("scoped");expect(inspectControlledCashReceipt.def.writeClass).toBe("money");expect(inspectControlledCashReceipt.def.auditInputFields).toEqual(["collectionId","receiptId"]);});
});
