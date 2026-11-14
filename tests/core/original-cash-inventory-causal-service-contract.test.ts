// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// PREPARED/UNRUN real registry input/output boundaries, not bank acceptance.
import {beforeAll,describe,expect,it} from "vitest";
import {ready} from "@/core/runtime";
import {getExternalService,getService} from "@/core/service";
const uuid="00000000-0000-4000-8000-000000000001";
describe("original inventory causal metadata is private server evidence",()=>{
 beforeAll(ready,120000);
 it("does not accept a supplied preimage/causal context or protocol through the private phase input",()=>{const claim=getService("invoicing.claimOriginalCashInspection"),check=getService("invoicing.checkOriginalCashInventory");expect(claim.def.input.safeParse({recoveryId:uuid}).success).toBe(true);expect(claim.def.input.safeParse({recoveryId:uuid,inventoryComparison:{allowed:true}}).success).toBe(false);expect(check.def.input.safeParse({recoveryId:uuid,operationId:uuid,causalRevision:"a".repeat(64),ownEntries:[]}).success).toBe(false);expect(()=>getExternalService(claim.def.name)).toThrow();});
 it("keeps the legacy target result shape and permits only a server-returned literal true refresh signal",()=>{const service=getService("invoicing.retainOriginalPartialCashTarget");expect(service.def.output.parse({targetFactId:uuid})).toEqual({targetFactId:uuid});expect(service.def.output.safeParse({targetFactId:uuid,requiresFreshInventory:true}).success).toBe(true);expect(service.def.output.safeParse({targetFactId:uuid,requiresFreshInventory:false}).success).toBe(false);expect(service.def.input.safeParse({recoveryId:uuid,operationId:uuid,authorizedBy:`user:${uuid}`,requiresFreshInventory:true}).success).toBe(false);});
 it("preserves shared human-only money return and rejects client bank/snapshot claims",()=>{const service=getExternalService("invoicing.returnOriginalCash");expect(service.def.permission).toBe("scoped");expect(service.def.stepUp).toBe(true);expect(service.def.agentCallable).toBe(false);expect(service.def.input.safeParse({source:{kind:"payment",paymentId:uuid},confirmation:"RETURN ONLY THIS ORIGINAL CASH",inventoryComparison:{allowed:true},fullCurrentRevision:"a".repeat(64)}).success).toBe(false);});
});
