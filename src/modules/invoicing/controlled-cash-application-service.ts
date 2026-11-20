// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C12.38: actual shared private money mutation; no bank POST or access effect.
import { z } from "zod";
import { defineService } from "@/core/service";
import { CONTROLLED_COLLECTION_PROTOCOL } from "@/modules/subscriptions/controlled-provider-collection-protocol";
import { applyControlledReceiptBatch } from "./controlled-receipt-batch-application";
/** Registration grants no money authority: the actual complete installed
 * protocol/guard bodies and genuine current proof are required before admission.
 * All callers use the same permissions/audit and ONE real money transaction. */
export const applyControlledCashReceipts=defineService({name:"invoicing.applyControlledReceiptBatch",summary:"Apply an explicit genuine original receipt batch to its exact canonical invoice through current immutable bank/parent stages.",kind:"mutation",permission:"system",external:false,writeClass:"money",auditInputFields:["collectionId","receiptIds"],
 input:z.object({collectionId:z.uuid(),receiptIds:z.array(z.uuid()).min(1).max(5000),requiredProtocol:z.literal(CONTROLLED_COLLECTION_PROTOCOL)}).strict(),
 output:z.object({invoiceId:z.uuid(),batchId:z.uuid(),payments:z.array(z.object({receiptId:z.uuid(),paymentId:z.uuid()}).strict()).min(1).max(5000),outstandingMinor:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),batchRevision:z.string().regex(/^[a-f0-9]{64}$/),suppliesAccessAuthority:z.literal(false)}).strict(),
 handler:async(input,ctx)=>applyControlledReceiptBatch(ctx,input),
});
export default[applyControlledCashReceipts];
