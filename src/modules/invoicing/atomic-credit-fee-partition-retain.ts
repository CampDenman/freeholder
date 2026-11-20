// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C12.38/C9.33: actual parent row first, independent sameTX child guard second.
import {eq,sql} from "drizzle-orm";
import {z} from "zod";
import {ServiceError,type ServiceContext} from "@/core/service";
import {invoiceCreditFunding} from "./credit-application-schema";
import {invoiceCreditFundingAtomicFeePartitions} from "./atomic-credit-fee-partition-schema";
import {ATOMIC_CREDIT_FEE_PROTOCOL} from "./atomic-credit-fee-protocol";
import type {controlledAtomicCreditFeePartition} from "./atomic-credit-fee-partition";
import {signAtomicCreditFeePartition,verifiedAtomicCreditFeePartition} from "./atomic-credit-fee-partition-proof";
import {originalCashEvidenceKeys,originalCashSigningKey} from "./original-cash-evidence-keys";
import {readAtomicCreditFeeDeclarationForProration} from "./atomic-credit-fee-declaration-reader";
type Candidate=NonNullable<Awaited<ReturnType<typeof controlledAtomicCreditFeePartition>>>;
function refuse():never{throw new ServiceError("conflict","Retain the exact actual inserted funding, same-transaction original fee partition and signed pre-insert current source graph; a planned or orphaned parent is not an original credit loan.");}
/** Candidate was genuinely produced immediately BEFORE the parent mutation.
 * SQL independently checks that exact actual parent delta and complete final
 * current graph. No fabricated before context or arbitrary caller exclusion. */
export async function retainAtomicCreditFundingPartition(ctx:ServiceContext,input:{fundingId:string;candidate:Candidate}){
 if(!z.uuid().safeParse(input.fundingId).success)refuse();
 const[parent]=await ctx.tx.select({row:invoiceCreditFunding,fingerprint:sql<string>`encode(sha256(convert_to(to_jsonb(${invoiceCreditFunding})::text,'UTF8')),'hex')`}).from(invoiceCreditFunding).where(eq(invoiceCreditFunding.id,input.fundingId)).limit(1);
 const candidate=input.candidate,plan=candidate.plan;
 if(!parent||plan.takePrincipalMinor<=0||parent.row.sourcePaymentId!==plan.sourcePaymentId||parent.row.sourceApplicationId!==plan.sourceApplicationId||parent.row.amountMinor!==plan.takePrincipalMinor
  ||parent.row.feeObligationMinor!==plan.takeAssignedFeeMinor||parent.row.feeProvenCollectedMinor!==plan.takeProvenCollectedMinor||parent.row.feeEvidenceDigest!==candidate.allocation.evidenceDigest
  ||parent.row.feeCollectionState!==candidate.allocation.collectionState||parent.row.feeUnexpected!==candidate.allocation.unexpectedFee
  ||candidate.beforeEntries.some(entry=>entry.key===`invoice_credit_funding:${parent.row.id}`||entry.key===`invoice_credit_funding_atomic_fee_partitions:${parent.row.id}`))refuse();
 const[transaction]=await ctx.tx.execute<{id:string}>(sql`select pg_current_xact_id()::text as id`),keys=originalCashEvidenceKeys(),key=originalCashSigningKey();if(!transaction)refuse();
 const source=await readAtomicCreditFeeDeclarationForProration(ctx.tx,parent.row.prorationId);
 const declared=source?.declaration.fundings.find(row=>row.fundingId===parent.row.id),principal=source?.principal.find(row=>row.sourcePaymentId===parent.row.sourcePaymentId&&row.sourceApplicationId===parent.row.sourceApplicationId);
 if(!source||!declared||!principal||declared.sourcePaymentId!==parent.row.sourcePaymentId||declared.sourceApplicationId!==parent.row.sourceApplicationId||declared.amountMinor!==parent.row.amountMinor||declared.feeEvidenceDigest!==parent.row.feeEvidenceDigest
  ||source.note.id!==parent.row.creditNoteId||source.line.id!==parent.row.creditNoteLineId||source.accepted.originalInvoiceId!==parent.row.sourceInvoiceId)refuse();
 const economics={...candidate.storedEconomics,birthDeclaration:{quoteId:source.quote.id,plannedFundingId:parent.row.id,prorationId:source.accepted.id,sourcePrincipalId:principal.id,creditNoteId:source.note.id,creditNoteLineId:source.line.id,declarationDigest:source.declaration.digest,declarationAuthentication:source.declaration.authentication,quoteFingerprint:source.quoteFingerprint}};
 const row={fundingId:parent.row.id,sourcePaymentId:parent.row.sourcePaymentId,sourceApplicationId:parent.row.sourceApplicationId,sourceInvoiceId:parent.row.sourceInvoiceId,creditNoteId:parent.row.creditNoteId,creditNoteLineId:parent.row.creditNoteLineId,
  originalChargeReceiptId:candidate.owner.receiptId,bankInspectionId:candidate.bank.inspectionId,bankObservationId:candidate.bank.observationId,protocol:ATOMIC_CREDIT_FEE_PROTOCOL,parentFingerprint:parent.fingerprint,
  economics,beforeEntries:candidate.beforeEntries,admissionTransactionId:transaction.id,createdAt:new Date()};
 const signed={...row,...signAtomicCreditFeePartition(row,key)};if(!verifiedAtomicCreditFeePartition(signed,keys))refuse();
 await ctx.tx.insert(invoiceCreditFundingAtomicFeePartitions).values(signed);return signed;
}
