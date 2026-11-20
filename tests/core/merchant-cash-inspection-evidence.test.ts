// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// PREPARED/UNRUN: real process identity, no bank/payment fixture is invented.
import { randomUUID } from "node:crypto";
import { describe,it,expect } from "vitest";
import { merchantPhysicalCaller } from "@/modules/invoicing/merchant-physical-caller";
import { cashInspectionCallersClosed } from "@/modules/invoicing/merchant-cash-inspection-evidence";
const admission=()=>({id:randomUUID(),caller:merchantPhysicalCaller()});
describe("bare original cash inspection caller fence",()=>{
 it("does not require a read where no actual admission exists",()=>{expect(cashInspectionCallersClosed([],[])).toBe(true);});
 it("retains debt before the first primary/state callback exists",()=>{expect(cashInspectionCallersClosed([admission()],[])).toBe(false);});
 it("accepts only the exact original returned caller",()=>{const original=admission();expect(cashInspectionCallersClosed([original],[{inspectionId:original.id,callerInstanceId:original.caller.id,outcome:"returned"}])).toBe(true);});
 it("a genuinely thrown wrapper closes its caller, without proving a returned inventory",()=>{const original=admission();expect(cashInspectionCallersClosed([original],[{inspectionId:original.id,callerInstanceId:original.caller.id,outcome:"threw"}])).toBe(true);});
 it("refuses a foreign process finish for the actual admitted read",()=>{const original=admission();expect(cashInspectionCallersClosed([original],[{inspectionId:original.id,callerInstanceId:randomUUID(),outcome:"returned"}])).toBe(false);});
 it("cannot release an older unobserved admission by a later successful read",()=>{const old=admission(),later=admission();expect(cashInspectionCallersClosed([old,later],[{inspectionId:later.id,callerInstanceId:later.caller.id,outcome:"returned"}])).toBe(false);});
 it("refuses duplicate or orphan finish identities instead of inferring closure from counts",()=>{const original=admission(),finish={inspectionId:original.id,callerInstanceId:original.caller.id,outcome:"returned" as const};expect(cashInspectionCallersClosed([original],[finish,finish])).toBe(false);expect(cashInspectionCallersClosed([],[finish])).toBe(false);});
});
