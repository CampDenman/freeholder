// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C12.38: authentic observational GET coverage only; no money/access grant.
import { z } from "zod";
import { defineService } from "@/core/service";
import { CONTROLLED_COLLECTION_PROTOCOL } from "@/modules/subscriptions/controlled-provider-collection-contract";
import { readControlledCashObservationParent } from "./controlled-cash-observation-parent";
const sha=z.string().regex(/^[a-f0-9]{64}$/);
export const controlledProviderCashObservationAuthority=defineService({
 name:"invoicing.controlledProviderCashObservationAuthority",summary:"Authenticate complete original parent ownership and actual caller coverage before a debt-observing bank GET.",
 kind:"query",permission:"system",external:false,
 input:z.object({collectionId:z.uuid(),receiptId:z.uuid(),requiredProtocol:z.literal(CONTROLLED_COLLECTION_PROTOCOL),inspectionId:z.uuid().optional()}).strict(),
 output:z.object({allowed:z.literal(true),revision:sha,causalSourceRevision:sha}).strict(),
 handler:async(input,ctx)=>({allowed:true as const,...await readControlledCashObservationParent(ctx,input)}),
});
export default [controlledProviderCashObservationAuthority];
