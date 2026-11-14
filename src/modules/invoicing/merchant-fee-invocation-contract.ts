// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C12.38: dependency-free private capability shape, never financial authority.
import {z} from "zod";
export const MERCHANT_FEE_STOP_CONFIRMATION="THE ORIGINAL FEE CALLER HAS STOPPED";
export const merchantFeeInvocationClaim=z.object({invocationId:z.uuid(),paymentId:z.uuid(),feeOperationId:z.uuid().nullable(),kind:z.enum(["source_inspect","post","recover_get"]),sourceReadKind:z.enum(["payment_source","fee_preflight"]).nullable(),nonce:z.string().regex(/^[A-Za-z0-9_-]{43}$/)}).strict();
export type MerchantFeeInvocationClaim=z.infer<typeof merchantFeeInvocationClaim>;
/** Preserve observed financial fields before source/counter classification.
 * Missing/malformed counters stay explicit; never coerce them to zero. */
export function merchantFeePreflightResult(value:unknown){
 const raw=z.record(z.string(),z.unknown()).parse(value);
 const ref=(actual:unknown):string|null=>typeof actual==="string"?actual:actual!==null&&typeof actual==="object"&&!Array.isArray(actual)&&"id" in actual&&typeof actual.id==="string"?actual.id:null;
 return{source:"fee_preflight",applicationFeeRef:ref(raw.id),accountId:ref(raw.account),chargeRef:ref(raw.charge),originatingChargeRef:ref(raw.originating_transaction),amountMinor:raw.amount??null,returnedMinor:raw.amount_refunded??null,currency:raw.currency??null};
}
